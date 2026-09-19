import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Brackets, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import type { Env } from '../../config/env.schema';
import { STORAGE_SERVICE } from '../../infrastructure/storage/storage.interface';
import type { StorageService } from '../../infrastructure/storage/storage.interface';
import { Employee } from '../employees/entities/employee.entity';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  CreateDocumentDto,
  DownloadLinkResponse,
  ListDocumentsQueryDto,
  UpdateDocumentDto,
} from './dto/documents.dto';
import type { UploadedFile } from './dto/documents.dto';
import { DocumentVersion } from './entities/document-version.entity';
import {
  Document,
  DocumentCategory,
  DocumentVisibility,
} from './entities/document.entity';

/** MIME types we accept for documents. Anything else is a 415. */
export const ALLOWED_DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const ALLOWED_PHOTO_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** Categories only HR may create/replace for someone else. */
const HR_ONLY_CATEGORIES = new Set([
  DocumentCategory.CONTRACT,
  DocumentCategory.PAYSLIP,
]);

@Injectable()
export class DocumentsService {
  private readonly maxBytes: number;
  private readonly downloadTtl: number;

  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    @InjectRepository(DocumentVersion)
    private readonly versions: Repository<DocumentVersion>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly employees: EmployeesService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024;
    this.downloadTtl = config.get('DOWNLOAD_URL_TTL_SECONDS', { infer: true });
  }

  // ── Create / version ──────────────────────────────────────────────────

  async create(
    file: UploadedFile,
    dto: CreateDocumentDto,
    actor: AuthUser,
  ): Promise<Document> {
    this.validateFile(file, ALLOWED_DOCUMENT_MIME);
    const isHr = actor.permissions.includes(PERMISSIONS.DOCUMENT_MANAGE);
    const visibility = dto.visibility ?? DocumentVisibility.PRIVATE;

    let ownerEmployeeId: string | null;
    if (dto.ownerEmployeeId !== undefined) {
      ownerEmployeeId = dto.ownerEmployeeId;
    } else if (isHr) {
      ownerEmployeeId = null; // company-level unless HR names an owner
    } else {
      ownerEmployeeId = (await this.requireProfile(actor)).id;
    }

    if (!isHr) {
      const me = await this.requireProfile(actor);
      if (ownerEmployeeId !== me.id)
        throw new ForbiddenException(
          'You can only upload documents for yourself',
        );
      if (visibility === DocumentVisibility.COMPANY)
        throw new ForbiddenException(
          'Only HR can publish company-wide documents',
        );
      if (HR_ONLY_CATEGORIES.has(dto.category))
        throw new ForbiddenException(
          `${dto.category} documents are issued by HR`,
        );
    }
    if (
      ownerEmployeeId &&
      !(await this.employeeRepo.exists({ where: { id: ownerEmployeeId } }))
    ) {
      throw new NotFoundException('Owner employee not found');
    }
    if (!ownerEmployeeId && visibility !== DocumentVisibility.COMPANY) {
      throw new BadRequestException(
        'Company-level documents must have COMPANY visibility',
      );
    }

    const doc = await this.documents.save(
      this.documents.create({
        ownerEmployeeId,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category,
        visibility,
        currentVersionId: null,
        uploadedByUserId: actor.id,
        kbIndexedAt: null,
      }),
    );
    await this.storeVersion(doc, file, actor.id, 1);
    return this.findById(doc.id);
  }

  async addVersion(
    id: string,
    file: UploadedFile,
    actor: AuthUser,
  ): Promise<Document> {
    const doc = await this.findById(id);
    this.assertCanEdit(doc, actor);
    this.validateFile(file, ALLOWED_DOCUMENT_MIME);
    const next =
      (doc.versions.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
    await this.storeVersion(doc, file, actor.id, next);
    return this.findById(id);
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    actor: AuthUser,
  ): Promise<Document> {
    const doc = await this.findById(id);
    this.assertCanEdit(doc, actor);
    const isHr = actor.permissions.includes(PERMISSIONS.DOCUMENT_MANAGE);
    if (!isHr && dto.visibility === DocumentVisibility.COMPANY) {
      throw new ForbiddenException(
        'Only HR can publish company-wide documents',
      );
    }
    if (!isHr && dto.category && HR_ONLY_CATEGORIES.has(dto.category)) {
      throw new ForbiddenException(
        `${dto.category} documents are issued by HR`,
      );
    }
    Object.assign(
      doc,
      Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
    );
    // Visibility/category changes may un-qualify a policy for the knowledge base.
    doc.kbIndexedAt = null;
    await this.documents.save(doc);
    return this.findById(id);
  }

  /** Soft delete; versions and storage objects are retained. */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const doc = await this.findById(id);
    this.assertCanEdit(doc, actor);
    await this.documents.softDelete(id);
  }

  // ── Read ──────────────────────────────────────────────────────────────

  async findById(id: string): Promise<Document> {
    const doc = await this.documents.findOne({
      where: { id },
      relations: { versions: true, currentVersion: true, owner: true },
      order: { versions: { version: 'DESC' } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /**
   * HR (`document:read_all`) sees everything. Everyone else sees company
   * documents, their own, and PRIVATE documents of their reports.
   */
  async list(
    query: ListDocumentsQueryDto,
    actor: AuthUser,
  ): Promise<PaginatedResponse<Document>> {
    const qb = this.documents
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.currentVersion', 'v')
      .leftJoinAndSelect('d.owner', 'o')
      .orderBy('d.createdAt', 'DESC')
      .skip(query.skip)
      .take(query.limit);

    if (!actor.permissions.includes(PERMISSIONS.DOCUMENT_READ_ALL)) {
      const me = await this.employees.findByUserId(actor.id);
      const reportIds = me ? await this.reportIds(me.id) : [];
      qb.andWhere(
        new Brackets((w) => {
          w.where('d.visibility = :company', {
            company: DocumentVisibility.COMPANY,
          });
          if (me) w.orWhere('d.ownerEmployeeId = :me', { me: me.id });
          if (reportIds.length) {
            w.orWhere(
              '(d.visibility = :private AND d.ownerEmployeeId IN (:...reports))',
              {
                private: DocumentVisibility.PRIVATE,
                reports: reportIds,
              },
            );
          }
        }),
      );
    }
    if (query.ownerEmployeeId)
      qb.andWhere('d.ownerEmployeeId = :owner', {
        owner: query.ownerEmployeeId,
      });
    if (query.category)
      qb.andWhere('d.category = :category', { category: query.category });
    if (query.visibility)
      qb.andWhere('d.visibility = :visibility', {
        visibility: query.visibility,
      });
    if (query.search)
      qb.andWhere('d.title ILIKE :s', { s: `%${query.search}%` });

    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  async canRead(doc: Document, actor: AuthUser): Promise<boolean> {
    if (actor.permissions.includes(PERMISSIONS.DOCUMENT_READ_ALL)) return true;
    if (doc.visibility === DocumentVisibility.COMPANY) return true;
    if (!doc.ownerEmployeeId) return false;
    const me = await this.employees.findByUserId(actor.id);
    if (!me) return false;
    if (doc.ownerEmployeeId === me.id) return true;
    if (doc.visibility === DocumentVisibility.RESTRICTED) return false;
    return this.employees.isInReportingChain(me.id, doc.ownerEmployeeId);
  }

  async downloadLink(
    id: string,
    actor: AuthUser,
    version?: number,
  ): Promise<DownloadLinkResponse> {
    const doc = await this.findById(id);
    if (!(await this.canRead(doc, actor))) throw new ForbiddenException();
    const v = version
      ? doc.versions.find((x) => x.version === version)
      : doc.currentVersion;
    if (!v) throw new NotFoundException('Version not found');
    const url = await this.storage.signedDownloadUrl(v.storageKey, {
      resourceType: v.resourceType,
      expiresInSeconds: this.downloadTtl,
      filename: v.originalFilename,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + this.downloadTtl * 1000).toISOString(),
      filename: v.originalFilename,
      version: v.version,
    };
  }

  // ── Profile photo ─────────────────────────────────────────────────────

  /** Public-access image; the CDN URL is stored straight on the employee. */
  async setProfilePhoto(
    employeeId: string,
    file: UploadedFile,
  ): Promise<Employee> {
    this.validateFile(file, ALLOWED_PHOTO_MIME, 5 * 1024 * 1024);
    const emp = await this.employees.findById(employeeId);
    const stored = await this.storage.upload(file.buffer, {
      folder: `employees/${employeeId}/photo`,
      filename: file.originalname,
      mimeType: file.mimetype,
      access: 'public',
    });
    return this.employees.updateProfile(emp.id, { photoUrl: stored.url });
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async storeVersion(
    doc: Document,
    file: UploadedFile,
    userId: string,
    version: number,
  ): Promise<DocumentVersion> {
    const stored = await this.storage.upload(file.buffer, {
      folder: doc.ownerEmployeeId
        ? `employees/${doc.ownerEmployeeId}/documents`
        : 'company/documents',
      filename: file.originalname,
      mimeType: file.mimetype,
      access: 'private',
    });
    const v = await this.versions.save(
      this.versions.create({
        documentId: doc.id,
        version,
        storageKey: stored.key,
        resourceType: stored.resourceType,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        bytes: file.size,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedByUserId: userId,
      }),
    );
    await this.documents.update(doc.id, {
      currentVersionId: v.id,
      kbIndexedAt: null,
    });
    return v;
  }

  private validateFile(
    file: UploadedFile | undefined,
    allowed: Set<string>,
    maxBytes = this.maxBytes,
  ): void {
    if (!file)
      throw new BadRequestException(
        'A file is required (multipart field "file")',
      );
    if (file.size > maxBytes)
      throw new PayloadTooLargeException(
        `File exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`,
      );
    if (!allowed.has(file.mimetype))
      throw new UnsupportedMediaTypeException(
        `Unsupported file type ${file.mimetype}`,
      );
  }

  private assertCanEdit(doc: Document, actor: AuthUser): void {
    if (actor.permissions.includes(PERMISSIONS.DOCUMENT_MANAGE)) return;
    if (doc.uploadedByUserId === actor.id) return;
    throw new ForbiddenException(
      'Only the uploader or HR can change this document',
    );
  }

  private async requireProfile(actor: AuthUser): Promise<Employee> {
    const me = await this.employees.findByUserId(actor.id);
    if (!me)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    return me;
  }

  private async reportIds(managerId: string): Promise<string[]> {
    const rows: { id: string }[] = await this.employeeRepo.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM employees WHERE manager_id = $1
         UNION ALL
         SELECT e.id FROM employees e JOIN tree t ON e.manager_id = t.id
       ) SELECT id FROM tree LIMIT 5000`,
      [managerId],
    );
    return rows.map((r) => r.id);
  }
}
