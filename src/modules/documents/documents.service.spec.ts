import {
  BadRequestException,
  ForbiddenException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { MemoryStorageService } from '../../infrastructure/storage/memory-storage.service';
import { STORAGE_SERVICE } from '../../infrastructure/storage/storage.interface';
import { Employee } from '../employees/entities/employee.entity';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { UserStatus } from '../users/entities/user.entity';
import { DocumentsService } from './documents.service';
import type { UploadedFile } from './dto/documents.dto';
import { DocumentVersion } from './entities/document-version.entity';
import {
  Document,
  DocumentCategory,
  DocumentVisibility,
} from './entities/document.entity';

const actor = (o: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u-emp',
  email: 'e@x',
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PERMISSIONS.DOCUMENT_UPLOAD],
  passwordChangedAt: null,
  ...o,
});
const HR = actor({
  id: 'u-hr',
  permissions: [
    PERMISSIONS.DOCUMENT_MANAGE,
    PERMISSIONS.DOCUMENT_READ_ALL,
    PERMISSIONS.DOCUMENT_UPLOAD,
  ],
});

const pdf = (size = 1000): UploadedFile => ({
  originalname: 'a.pdf',
  mimetype: 'application/pdf',
  size,
  buffer: Buffer.alloc(size, 1),
});

describe('DocumentsService', () => {
  let service: DocumentsService;
  let storage: MemoryStorageService;
  let documents: Record<string, jest.Mock>;
  let versions: Record<string, jest.Mock>;
  let employees: Record<string, jest.Mock>;
  let saved: Document;

  const doc = (o: Partial<Document> = {}): Document =>
    Object.assign(new Document(), {
      id: 'd1',
      ownerEmployeeId: 'e-owner',
      visibility: DocumentVisibility.PRIVATE,
      category: DocumentCategory.OTHER,
      uploadedByUserId: 'u-emp',
      versions: [],
      currentVersion: null,
      ...o,
    });

  beforeEach(async () => {
    storage = new MemoryStorageService();
    documents = {
      create: jest.fn((v) => Object.assign(new Document(), v)),
      save: jest.fn(async (d) => (saved = Object.assign(d, { id: 'd1' }))),
      update: jest.fn(),
      findOne: jest.fn(async () => saved ?? null),
      softDelete: jest.fn(),
    };
    versions = {
      create: jest.fn((v) => Object.assign(new DocumentVersion(), v)),
      save: jest.fn(async (v) => Object.assign(v, { id: 'v1' })),
    };
    employees = {
      findByUserId: jest.fn(async () => ({ id: 'e-owner' })),
      findById: jest.fn(),
      isInReportingChain: jest.fn(async () => false),
      updateProfile: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: getRepositoryToken(Document), useValue: documents },
        { provide: getRepositoryToken(DocumentVersion), useValue: versions },
        {
          provide: getRepositoryToken(Employee),
          useValue: {
            exists: jest.fn(async () => true),
            query: jest.fn(async () => []),
          },
        },
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: EmployeesService, useValue: employees },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({ MAX_UPLOAD_MB: 1, DOWNLOAD_URL_TTL_SECONDS: 300 })[k],
          },
        },
      ],
    }).compile();
    service = moduleRef.get(DocumentsService);
  });

  describe('create', () => {
    it('stores a private object, records version 1 with a checksum and points current at it', async () => {
      await service.create(
        pdf(),
        { title: 'CV', category: DocumentCategory.OTHER },
        actor(),
      );

      expect([...storage.objects.values()][0].options).toMatchObject({
        access: 'private',
        folder: 'employees/e-owner/documents',
      });
      const v = versions.save.mock.calls[0][0] as DocumentVersion;
      expect(v).toMatchObject({
        version: 1,
        mimeType: 'application/pdf',
        bytes: 1000,
        resourceType: 'raw',
      });
      expect(v.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(documents.update).toHaveBeenCalledWith('d1', {
        currentVersionId: 'v1',
        kbIndexedAt: null,
      });
    });

    it('rejects oversized and unsupported files before touching storage', async () => {
      await expect(
        service.create(
          pdf(2 * 1024 * 1024),
          { title: 'x', category: DocumentCategory.OTHER },
          actor(),
        ),
      ).rejects.toThrow(PayloadTooLargeException);
      await expect(
        service.create(
          { ...pdf(), mimetype: 'application/x-msdownload' },
          { title: 'x', category: DocumentCategory.OTHER },
          actor(),
        ),
      ).rejects.toThrow(UnsupportedMediaTypeException);
      expect(storage.objects.size).toBe(0);
    });

    it('employees cannot upload for others, publish company-wide, or issue contracts', async () => {
      await expect(
        service.create(
          pdf(),
          {
            title: 'x',
            category: DocumentCategory.OTHER,
            ownerEmployeeId: 'someone',
          },
          actor(),
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.create(
          pdf(),
          {
            title: 'x',
            category: DocumentCategory.OTHER,
            visibility: DocumentVisibility.COMPANY,
          },
          actor(),
        ),
      ).rejects.toThrow(/company-wide/);
      await expect(
        service.create(
          pdf(),
          { title: 'x', category: DocumentCategory.CONTRACT },
          actor(),
        ),
      ).rejects.toThrow(/issued by HR/);
    });

    it('HR creates company-level policies (no owner) with COMPANY visibility only', async () => {
      await expect(
        service.create(
          pdf(),
          { title: 'Handbook', category: DocumentCategory.POLICY },
          HR,
        ),
      ).rejects.toThrow(BadRequestException);
      await service.create(
        pdf(),
        {
          title: 'Handbook',
          category: DocumentCategory.POLICY,
          visibility: DocumentVisibility.COMPANY,
        },
        HR,
      );
      expect(documents.save.mock.calls[0][0]).toMatchObject({
        ownerEmployeeId: null,
        visibility: DocumentVisibility.COMPANY,
      });
      expect([...storage.objects.values()][0].options.folder).toBe(
        'company/documents',
      );
    });
  });

  describe('canRead', () => {
    it('HR reads everything; COMPANY is open to all', async () => {
      expect(
        await service.canRead(
          doc({ visibility: DocumentVisibility.RESTRICTED }),
          HR,
        ),
      ).toBe(true);
      employees.findByUserId.mockResolvedValue(null);
      expect(
        await service.canRead(
          doc({ visibility: DocumentVisibility.COMPANY }),
          actor({ id: 'nobody' }),
        ),
      ).toBe(true);
    });

    it('owner reads own; chain reads PRIVATE but not RESTRICTED; others nothing', async () => {
      employees.findByUserId.mockResolvedValue({ id: 'e-owner' });
      expect(
        await service.canRead(
          doc({ visibility: DocumentVisibility.RESTRICTED }),
          actor(),
        ),
      ).toBe(true);

      employees.findByUserId.mockResolvedValue({ id: 'e-mgr' });
      employees.isInReportingChain.mockResolvedValue(true);
      expect(
        await service.canRead(
          doc({ visibility: DocumentVisibility.PRIVATE }),
          actor({ id: 'u-mgr' }),
        ),
      ).toBe(true);
      expect(
        await service.canRead(
          doc({ visibility: DocumentVisibility.RESTRICTED }),
          actor({ id: 'u-mgr' }),
        ),
      ).toBe(false);

      employees.isInReportingChain.mockResolvedValue(false);
      expect(
        await service.canRead(
          doc({ visibility: DocumentVisibility.PRIVATE }),
          actor({ id: 'u-other' }),
        ),
      ).toBe(false);
    });
  });

  describe('downloadLink', () => {
    it('returns a signed URL for the current version, or a named one; never the storage key', async () => {
      const v1 = Object.assign(new DocumentVersion(), {
        id: 'v1',
        version: 1,
        storageKey: 'k1',
        resourceType: 'raw',
        originalFilename: 'a.pdf',
      });
      const v2 = Object.assign(new DocumentVersion(), {
        id: 'v2',
        version: 2,
        storageKey: 'k2',
        resourceType: 'raw',
        originalFilename: 'b.pdf',
      });
      documents.findOne.mockResolvedValue(
        doc({ versions: [v2, v1], currentVersion: v2 }),
      );

      const link = await service.downloadLink('d1', HR);
      expect(link).toMatchObject({ version: 2, filename: 'b.pdf' });
      expect(link.url).toContain('memory://k2?expires=');
      expect((await service.downloadLink('d1', HR, 1)).version).toBe(1);
    });

    it('is forbidden without read access', async () => {
      employees.findByUserId.mockResolvedValue({ id: 'e-other' });
      documents.findOne.mockResolvedValue(doc());
      await expect(
        service.downloadLink('d1', actor({ id: 'u-other' })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('edit rights', () => {
    it('only the uploader or HR can add versions / edit / delete', async () => {
      documents.findOne.mockResolvedValue(
        doc({
          uploadedByUserId: 'u-emp',
          versions: [{ version: 1 } as DocumentVersion],
        }),
      );
      await expect(
        service.remove('d1', actor({ id: 'u-stranger' })),
      ).rejects.toThrow(ForbiddenException);
      await service.remove('d1', actor());
      expect(documents.softDelete).toHaveBeenCalledWith('d1');

      await service.addVersion('d1', pdf(), HR);
      expect(versions.save.mock.calls[0][0].version).toBe(2);
    });
  });

  it('profile photo: images only, uploaded public, URL written to the employee', async () => {
    employees.findById.mockResolvedValue({ id: 'e1' });
    await expect(service.setProfilePhoto('e1', pdf())).rejects.toThrow(
      UnsupportedMediaTypeException,
    );
    await service.setProfilePhoto('e1', {
      originalname: 'me.png',
      mimetype: 'image/png',
      size: 10,
      buffer: Buffer.alloc(10),
    });
    expect([...storage.objects.values()][0].options.access).toBe('public');
    expect(employees.updateProfile).toHaveBeenCalledWith('e1', {
      photoUrl: expect.stringMatching(/^memory:\/\/employees\/e1\/photo\//),
    });
  });
});
