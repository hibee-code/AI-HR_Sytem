import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import type { Env } from '../../config/env.schema';
import { CHAT_MODEL } from '../../infrastructure/ai/chat-model.interface';
import type { ChatModel } from '../../infrastructure/ai/chat-model.interface';
import { EMBEDDINGS_PROVIDER } from '../../infrastructure/ai/embeddings.interface';
import type { EmbeddingsProvider } from '../../infrastructure/ai/embeddings.interface';
import { STORAGE_SERVICE } from '../../infrastructure/storage/storage.interface';
import type { StorageService } from '../../infrastructure/storage/storage.interface';
import { extractText } from '../ai/text-extraction';
import { DocumentsService } from '../documents/documents.service';
import type {
  DownloadLinkResponse,
  UploadedFile,
} from '../documents/dto/documents.dto';
import {
  DocumentCategory,
  DocumentVisibility,
} from '../documents/entities/document.entity';
import { Department } from '../employees/entities/department.entity';
import { Position } from '../employees/entities/position.entity';
import {
  ApplyDto,
  CreateOpeningDto,
  ListApplicationsQueryDto,
  ListOpeningsQueryDto,
  UpdateApplicationStatusDto,
  UpdateOpeningDto,
} from './dto/recruiting.dto';
import {
  Application,
  ApplicationStatus,
  ScreeningStatus,
} from './entities/application.entity';
import { Candidate } from './entities/candidate.entity';
import { JobOpening, OpeningStatus } from './entities/job-opening.entity';
import { screenResume, ScreeningParseError } from './screener';

export const RESUME_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

@Injectable()
export class RecruitingService {
  private readonly maxTokens: number;

  constructor(
    @InjectRepository(JobOpening)
    private readonly openings: Repository<JobOpening>,
    @InjectRepository(Candidate)
    private readonly candidates: Repository<Candidate>,
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(Position)
    private readonly positions: Repository<Position>,
    @Inject(EMBEDDINGS_PROVIDER)
    private readonly embeddings: EmbeddingsProvider,
    @Inject(CHAT_MODEL) private readonly chat: ChatModel,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly documents: DocumentsService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    this.maxTokens = config.get('AI_MAX_OUTPUT_TOKENS', { infer: true });
  }

  // ── Openings ──────────────────────────────────────────────────────────

  async createOpening(
    dto: CreateOpeningDto,
    ownerUserId: string,
  ): Promise<JobOpening> {
    if (!(await this.departments.exists({ where: { id: dto.departmentId } })))
      throw new NotFoundException('Department not found');
    if (
      dto.positionId &&
      !(await this.positions.exists({ where: { id: dto.positionId } }))
    )
      throw new NotFoundException('Position not found');
    const o = await this.openings.save(
      this.openings.create({
        title: dto.title,
        departmentId: dto.departmentId,
        positionId: dto.positionId ?? null,
        description: dto.description,
        requirements: dto.requirements.map((r) => r.trim()).filter(Boolean),
        status: OpeningStatus.DRAFT,
        ownerUserId,
        closedAt: null,
      }),
    );
    return this.findOpening(o.id);
  }

  async updateOpening(id: string, dto: UpdateOpeningDto): Promise<JobOpening> {
    const o = await this.findOpening(id);
    if (
      dto.departmentId &&
      !(await this.departments.exists({ where: { id: dto.departmentId } }))
    )
      throw new NotFoundException('Department not found');
    if (
      dto.positionId &&
      !(await this.positions.exists({ where: { id: dto.positionId } }))
    )
      throw new NotFoundException('Position not found');
    for (const k of [
      'title',
      'departmentId',
      'positionId',
      'description',
    ] as const) {
      if (dto[k] !== undefined)
        (o as unknown as Record<string, unknown>)[k] = dto[k];
    }
    if (dto.requirements)
      o.requirements = dto.requirements.map((r) => r.trim()).filter(Boolean);
    if (dto.status && dto.status !== o.status) {
      if (
        o.status === OpeningStatus.CLOSED &&
        dto.status !== OpeningStatus.CLOSED
      )
        throw new BadRequestException(
          'Closed openings cannot be reopened; create a new one',
        );
      o.status = dto.status;
      o.closedAt = dto.status === OpeningStatus.CLOSED ? new Date() : null;
    }
    await this.openings.save(o);
    return this.findOpening(id);
  }

  async findOpening(id: string): Promise<JobOpening> {
    const o = await this.openings.findOne({
      where: { id },
      relations: { department: true, position: true, owner: true },
    });
    if (!o) throw new NotFoundException('Job opening not found');
    return o;
  }

  async listOpenings(
    query: ListOpeningsQueryDto,
  ): Promise<PaginatedResponse<JobOpening>> {
    const [data, total] = await this.openings.findAndCount({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      },
      relations: { department: true, position: true },
      order: { createdAt: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return new PaginatedResponse(data, total, query);
  }

  // ── Applications ──────────────────────────────────────────────────────

  /** Stores the résumé as a recruiting-only document and creates the application; screening runs in a job. */
  async apply(
    openingId: string,
    dto: ApplyDto,
    file: UploadedFile | undefined,
    actorUserId: string,
  ): Promise<Application> {
    const opening = await this.findOpening(openingId);
    if (opening.status !== OpeningStatus.OPEN)
      throw new BadRequestException('Opening is not accepting applications');
    if (!file)
      throw new BadRequestException(
        'A résumé file is required (multipart field "file")',
      );
    if (!RESUME_MIME.has(file.mimetype))
      throw new BadRequestException(
        'Résumé must be PDF, DOCX, TXT or Markdown',
      );

    let candidate = await this.candidates.findOne({
      where: { email: dto.email },
    });
    if (!candidate) {
      candidate = await this.candidates.save(
        this.candidates.create({
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone ?? null,
          source: dto.source ?? null,
        }),
      );
    } else if (
      await this.applications.exists({
        where: { openingId, candidateId: candidate.id },
      })
    ) {
      throw new ConflictException(
        'This candidate has already applied to this opening',
      );
    }

    const doc = await this.documents.createSystemDocument({
      ownerEmployeeId: null,
      title: `Résumé — ${candidate.fullName} — ${opening.title}`,
      category: DocumentCategory.RESUME,
      visibility: DocumentVisibility.RESTRICTED,
      file,
      createdByUserId: actorUserId,
    });

    const app = await this.applications.save(
      this.applications.create({
        openingId,
        candidateId: candidate.id,
        resumeDocumentId: doc.id,
        status: ApplicationStatus.APPLIED,
        screeningStatus: ScreeningStatus.PENDING,
        screening: null,
        fitScore: null,
        screeningError: null,
        coverLetter: dto.coverLetter ?? null,
        notes: null,
        statusChangedByUserId: null,
      }),
    );
    return this.findApplication(app.id);
  }

  async findApplication(id: string): Promise<Application> {
    const a = await this.applications.findOne({
      where: { id },
      relations: { candidate: true, opening: true, resumeDocument: true },
    });
    if (!a) throw new NotFoundException('Application not found');
    return a;
  }

  /** Ranked pipeline for an opening. Unscreened applications sort last. */
  async listApplications(
    openingId: string,
    query: ListApplicationsQueryDto,
  ): Promise<PaginatedResponse<Application>> {
    await this.findOpening(openingId);
    const qb = this.applications
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.candidate', 'c')
      .where('a.openingId = :openingId', { openingId })
      .skip(query.skip)
      .take(query.limit);
    if (query.status)
      qb.andWhere('a.status = :status', { status: query.status });
    if (query.minScore !== undefined)
      qb.andWhere('a.fitScore >= :minScore', { minScore: query.minScore });
    if (query.sort === 'newest') qb.orderBy('a.createdAt', 'DESC');
    else
      qb.orderBy('a.fitScore', 'DESC', 'NULLS LAST').addOrderBy(
        'a.createdAt',
        'ASC',
      );
    const [data, total] = await qb.getManyAndCount();
    return new PaginatedResponse(data, total, query);
  }

  async updateStatus(
    id: string,
    dto: UpdateApplicationStatusDto,
    actorUserId: string,
  ): Promise<Application> {
    const a = await this.findApplication(id);
    if (
      a.status === ApplicationStatus.HIRED ||
      a.status === ApplicationStatus.WITHDRAWN
    ) {
      throw new BadRequestException(
        `Application is ${a.status.toLowerCase()}; no further changes`,
      );
    }
    a.status = dto.status;
    a.statusChangedByUserId = actorUserId;
    if (dto.note) a.notes = a.notes ? `${a.notes}\n\n${dto.note}` : dto.note;
    await this.applications.save(a);
    return this.findApplication(id);
  }

  /** Recruiters read résumés through recruiting permissions, not document visibility. */
  resumeDownloadLink(app: Application): Promise<DownloadLinkResponse> {
    return this.documents.downloadLinkUnchecked(app.resumeDocumentId);
  }

  // ── Screening (job) ───────────────────────────────────────────────────

  async screen(applicationId: string): Promise<Application> {
    const app = await this.applications.findOne({
      where: { id: applicationId },
      relations: { opening: true, resumeDocument: { currentVersion: true } },
    });
    if (!app) throw new NotFoundException('Application not found');
    await this.applications.update(applicationId, {
      screeningStatus: ScreeningStatus.RUNNING,
      screeningError: null,
    });

    try {
      const version = app.resumeDocument.currentVersion;
      if (!version) throw new Error('Résumé has no stored version');
      const bytes = await this.storage.download(
        version.storageKey,
        version.resourceType,
      );
      const resumeText = (await extractText(bytes, version.mimeType)).trim();
      if (resumeText.length < 50)
        throw new Error('Résumé text could not be extracted (scanned image?)');

      const result = await screenResume(
        {
          title: app.opening.title,
          description: app.opening.description,
          requirements: app.opening.requirements,
          resumeText,
        },
        this.embeddings,
        this.chat,
        this.maxTokens,
      );
      await this.applications.update(applicationId, {
        screening: result,
        fitScore: result.fitScore,
        screeningStatus: ScreeningStatus.DONE,
        screeningError: null,
      });
    } catch (err) {
      const message = ((err as Error).message ?? String(err)).slice(0, 500);
      await this.applications.update(applicationId, {
        screeningStatus: ScreeningStatus.FAILED,
        screeningError: message,
      });
      this.logger.warn(
        {
          applicationId,
          err: message,
          parse: err instanceof ScreeningParseError,
        },
        'résumé screening failed',
      );
      throw err; // BullMQ retries with backoff
    }
    return this.findApplication(applicationId);
  }

  async pendingScreeningIds(openingId?: string): Promise<string[]> {
    const rows = await this.applications.find({
      where: {
        screeningStatus: ScreeningStatus.PENDING,
        ...(openingId ? { openingId } : {}),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
