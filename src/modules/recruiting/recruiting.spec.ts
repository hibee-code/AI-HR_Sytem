import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { CHAT_MODEL } from '../../infrastructure/ai/chat-model.interface';
import { EMBEDDINGS_PROVIDER } from '../../infrastructure/ai/embeddings.interface';
import { FakeChatAdapter } from '../../infrastructure/ai/fake-chat.adapter';
import { FakeEmbeddingsProvider } from '../../infrastructure/ai/fake-embeddings.provider';
import { MemoryStorageService } from '../../infrastructure/storage/memory-storage.service';
import { STORAGE_SERVICE } from '../../infrastructure/storage/storage.interface';
import { DocumentsService } from '../documents/documents.service';
import {
  DocumentCategory,
  DocumentVisibility,
} from '../documents/entities/document.entity';
import { Department } from '../employees/entities/department.entity';
import { Position } from '../employees/entities/position.entity';
import {
  Application,
  ApplicationStatus,
  ScreeningStatus,
} from './entities/application.entity';
import { Candidate } from './entities/candidate.entity';
import { JobOpening, OpeningStatus } from './entities/job-opening.entity';
import { RecruitingService } from './recruiting.service';
import {
  cosine,
  parseAssessment,
  ScreeningParseError,
  screenResume,
} from './screener';

describe('screener helpers', () => {
  it('parseAssessment tolerates fences and chatter, validates ranges', () => {
    const ok = parseAssessment(
      'Sure! ```json\n{"fitScore": 72, "summary": "Good", "strengths": ["a"], "gaps": []}\n``` hope this helps',
    );
    expect(ok).toMatchObject({
      fitScore: 72,
      summary: 'Good',
      strengths: ['a'],
      matchedRequirements: [],
    });
    expect(() => parseAssessment('no json here')).toThrow(ScreeningParseError);
    expect(() => parseAssessment('{"fitScore": 150, "summary": "x"}')).toThrow(
      /fitScore/,
    );
    expect(() => parseAssessment('{"fitScore": 50}')).toThrow(/summary/);
  });

  it('cosine is 1 for identical, 0 for orthogonal, clamped', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('screenResume combines similarity with the model assessment and flags it AI-assisted', async () => {
    const result = await screenResume(
      {
        title: 'Backend Engineer',
        description: 'Build services.',
        requirements: [
          'Experience with PostgreSQL',
          'Kubernetes deployments',
          'Fluent Spanish',
        ],
        resumeText:
          'Senior engineer. Ten years with PostgreSQL and Node services deployed on Kubernetes.',
      },
      new FakeEmbeddingsProvider(64),
      new FakeChatAdapter(),
      512,
    );
    expect(result.aiAssisted).toBe(true);
    expect(result.fitScore).toBe(67);
    expect(result.matchedRequirements).toEqual([
      'Experience with PostgreSQL',
      'Kubernetes deployments',
    ]);
    expect(result.missingRequirements).toEqual(['Fluent Spanish']);
    expect(result.similarity).toBeGreaterThan(0);
    expect(result.provider).toBe('fake');
  });
});

describe('RecruitingService', () => {
  let service: RecruitingService;
  let openings: Record<string, jest.Mock>;
  let candidates: Record<string, jest.Mock>;
  let applications: Record<string, jest.Mock>;
  let documents: {
    createSystemDocument: jest.Mock;
    downloadLinkUnchecked: jest.Mock;
  };
  let storage: MemoryStorageService;

  const opening = (o: Partial<JobOpening> = {}) =>
    Object.assign(new JobOpening(), {
      id: 'o1',
      title: 'Backend Engineer',
      description: 'Build services.',
      requirements: ['PostgreSQL', 'Kubernetes'],
      status: OpeningStatus.OPEN,
      ...o,
    });
  const resume = {
    originalname: 'cv.md',
    mimetype: 'text/markdown',
    size: 60,
    buffer: Buffer.from(
      'Engineer with PostgreSQL experience and Kubernetes deployments, ten years.',
    ),
  };

  beforeEach(async () => {
    openings = {
      findOne: jest.fn(async () => opening()),
      save: jest.fn(async (o) => o),
      create: jest.fn((v) => Object.assign(new JobOpening(), v)),
    };
    candidates = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (c) => Object.assign(c, { id: 'cand-1' })),
      create: jest.fn((v) => Object.assign(new Candidate(), v)),
    };
    applications = {
      exists: jest.fn(async () => false),
      save: jest.fn(async (a) => Object.assign(a, { id: 'app-1' })),
      create: jest.fn((v) => Object.assign(new Application(), v)),
      findOne: jest.fn(),
      update: jest.fn(),
      find: jest.fn(async () => []),
    };
    documents = {
      createSystemDocument: jest.fn(async () => ({ id: 'doc-1' })),
      downloadLinkUnchecked: jest.fn(),
    };
    storage = new MemoryStorageService();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RecruitingService,
        { provide: getRepositoryToken(JobOpening), useValue: openings },
        { provide: getRepositoryToken(Candidate), useValue: candidates },
        { provide: getRepositoryToken(Application), useValue: applications },
        {
          provide: getRepositoryToken(Department),
          useValue: { exists: jest.fn(async () => true) },
        },
        {
          provide: getRepositoryToken(Position),
          useValue: { exists: jest.fn(async () => true) },
        },
        {
          provide: EMBEDDINGS_PROVIDER,
          useValue: new FakeEmbeddingsProvider(64),
        },
        { provide: CHAT_MODEL, useValue: new FakeChatAdapter() },
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: DocumentsService, useValue: documents },
        { provide: Logger, useValue: { warn: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 1024 } },
      ],
    }).compile();
    service = moduleRef.get(RecruitingService);
  });

  describe('apply', () => {
    it('creates the candidate, stores the résumé as a RESTRICTED RESUME document, and a PENDING application', async () => {
      applications.findOne.mockResolvedValue(
        Object.assign(new Application(), { id: 'app-1' }),
      );
      await service.apply(
        'o1',
        { firstName: 'Ada', lastName: 'L', email: 'ada@x.io' },
        resume,
        'recruiter',
      );
      expect(candidates.save).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'ada@x.io' }),
      );
      expect(documents.createSystemDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerEmployeeId: null,
          category: DocumentCategory.RESUME,
          visibility: DocumentVisibility.RESTRICTED,
        }),
      );
      expect(applications.save).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeDocumentId: 'doc-1',
          screeningStatus: ScreeningStatus.PENDING,
        }),
      );
    });

    it('rejects closed openings, missing/invalid files, and duplicate applications', async () => {
      openings.findOne.mockResolvedValue(
        opening({ status: OpeningStatus.DRAFT }),
      );
      await expect(
        service.apply(
          'o1',
          { firstName: 'A', lastName: 'B', email: 'a@b.c' },
          resume,
          'r',
        ),
      ).rejects.toThrow(/not accepting/);
      openings.findOne.mockResolvedValue(opening());
      await expect(
        service.apply(
          'o1',
          { firstName: 'A', lastName: 'B', email: 'a@b.c' },
          undefined,
          'r',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.apply(
          'o1',
          { firstName: 'A', lastName: 'B', email: 'a@b.c' },
          { ...resume, mimetype: 'image/png' },
          'r',
        ),
      ).rejects.toThrow(/PDF, DOCX/);
      candidates.findOne.mockResolvedValue({ id: 'cand-1' });
      applications.exists.mockResolvedValue(true);
      await expect(
        service.apply(
          'o1',
          { firstName: 'A', lastName: 'B', email: 'a@b.c' },
          resume,
          'r',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('screen', () => {
    it('extracts the résumé, scores it, and stores the result with fitScore denormalised', async () => {
      const stored = await storage.upload(resume.buffer, {
        folder: 'x',
        filename: 'cv.md',
        mimeType: 'text/markdown',
        access: 'private',
      });
      applications.findOne
        .mockResolvedValueOnce(
          Object.assign(new Application(), {
            id: 'app-1',
            opening: opening(),
            resumeDocument: {
              currentVersion: {
                storageKey: stored.key,
                resourceType: 'raw',
                mimeType: 'text/markdown',
              },
            },
          }),
        )
        .mockResolvedValue(
          Object.assign(new Application(), { id: 'app-1', fitScore: 100 }),
        );

      await service.screen('app-1');

      expect(applications.update).toHaveBeenNthCalledWith(1, 'app-1', {
        screeningStatus: ScreeningStatus.RUNNING,
        screeningError: null,
      });
      expect(applications.update).toHaveBeenLastCalledWith(
        'app-1',
        expect.objectContaining({
          screeningStatus: ScreeningStatus.DONE,
          fitScore: 100,
          screening: expect.objectContaining({
            aiAssisted: true,
            matchedRequirements: ['PostgreSQL', 'Kubernetes'],
          }),
        }),
      );
    });

    it('marks FAILED (and rethrows for retry) when the résumé yields no text', async () => {
      const stored = await storage.upload(Buffer.from('tiny'), {
        folder: 'x',
        filename: 'cv.txt',
        mimeType: 'text/plain',
        access: 'private',
      });
      applications.findOne.mockResolvedValue(
        Object.assign(new Application(), {
          id: 'app-1',
          opening: opening(),
          resumeDocument: {
            currentVersion: {
              storageKey: stored.key,
              resourceType: 'raw',
              mimeType: 'text/plain',
            },
          },
        }),
      );
      await expect(service.screen('app-1')).rejects.toThrow(
        /could not be extracted/,
      );
      expect(applications.update).toHaveBeenLastCalledWith(
        'app-1',
        expect.objectContaining({
          screeningStatus: ScreeningStatus.FAILED,
          screeningError: expect.stringContaining('extracted'),
        }),
      );
    });
  });

  it('status changes are final for HIRED / WITHDRAWN', async () => {
    applications.findOne.mockResolvedValue(
      Object.assign(new Application(), {
        id: 'app-1',
        status: ApplicationStatus.HIRED,
      }),
    );
    await expect(
      service.updateStatus(
        'app-1',
        { status: ApplicationStatus.REJECTED },
        'r',
      ),
    ).rejects.toThrow(/hired/);
  });
});
