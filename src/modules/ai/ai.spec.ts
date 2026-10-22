import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import {
  AllProvidersFailedError,
  CHAT_MODEL,
} from '../../infrastructure/ai/chat-model.interface';
import { FakeChatAdapter } from '../../infrastructure/ai/fake-chat.adapter';
import { FakeEmbeddingsProvider } from '../../infrastructure/ai/fake-embeddings.provider';
import { AiUsageService } from './ai-usage.service';
import { AssistantService, NOT_FOUND_ANSWER } from './assistant.service';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage, AiMessageRole } from './entities/ai-message.entity';
import { KnowledgeBaseService } from './knowledge-base.service';
import { chunkText } from './text-extraction';

describe('chunkText', () => {
  it('splits long text into overlapping chunks and drops empties', async () => {
    const para =
      'Annual leave entitlement is twenty working days per calendar year. '.repeat(
        40,
      );
    const chunks = await chunkText(`${para}\n\n\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(2);
    expect(
      chunks.every((c) => c.content.length <= 1200 && c.content.length > 0),
    ).toBe(true);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(await chunkText('   \n\n  ')).toEqual([]);
  });
});

describe('FakeEmbeddingsProvider', () => {
  it('is deterministic, unit-length, and ranks related text closer', async () => {
    const p = new FakeEmbeddingsProvider(64);
    const [a, b, c] = await p.embed([
      'annual leave days per year',
      'how many leave days do I get each year',
      'payroll run approval pdf',
    ]);
    const dot = (x: number[], y: number[]) =>
      x.reduce((s, v, i) => s + v * y[i], 0);
    expect(Math.abs(dot(a, a) - 1)).toBeLessThan(1e-9);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c));
    expect((await p.embed(['annual leave days per year']))[0]).toEqual(a);
  });
});

describe('AssistantService', () => {
  let service: AssistantService;
  let conversations: Record<string, jest.Mock>;
  let messages: Record<string, jest.Mock>;
  let kb: { search: jest.Mock };
  let usage: { assertWithinDailyLimit: jest.Mock; record: jest.Mock };
  let chat: FakeChatAdapter;

  beforeEach(async () => {
    conversations = {
      create: jest.fn((v) => Object.assign(new AiConversation(), v)),
      save: jest.fn(async (c) => Object.assign(c, { id: c.id ?? 'conv-1' })),
      findOne: jest.fn(async () =>
        Object.assign(new AiConversation(), { id: 'conv-1', userId: 'u1' }),
      ),
      update: jest.fn(),
      remove: jest.fn(),
    };
    let n = 0;
    messages = {
      create: jest.fn((v) => Object.assign(new AiMessage(), v)),
      save: jest.fn(async (m) => Object.assign(m, { id: `m-${++n}` })),
      find: jest.fn(async () => []),
    };
    kb = { search: jest.fn(async () => []) };
    usage = { assertWithinDailyLimit: jest.fn(), record: jest.fn() };
    chat = new FakeChatAdapter();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AssistantService,
        {
          provide: getRepositoryToken(AiConversation),
          useValue: conversations,
        },
        { provide: getRepositoryToken(AiMessage), useValue: messages },
        { provide: CHAT_MODEL, useValue: chat },
        { provide: KnowledgeBaseService, useValue: kb },
        { provide: AiUsageService, useValue: usage },
        { provide: Logger, useValue: { error: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 4096 } },
      ],
    }).compile();
    service = moduleRef.get(AssistantService);
  });

  const policyChunk = {
    documentId: 'd1',
    title: 'Leave policy',
    chunkIndex: 0,
    content: 'Employees get 20 days of annual leave.',
    similarity: 0.8,
  };

  it('enforces the daily cap before creating anything', async () => {
    usage.assertWithinDailyLimit.mockRejectedValueOnce(new Error('limit'));
    await expect(service.ask('u1', 'Leave days?')).rejects.toThrow('limit');
    expect(conversations.save).not.toHaveBeenCalled();
    expect(messages.save).not.toHaveBeenCalled();
  });

  it('records usage only when a model was called', async () => {
    await service.ask('u1', 'What is the dress code?');
    expect(usage.record).not.toHaveBeenCalled();
    kb.search.mockResolvedValueOnce([policyChunk]);
    await service.ask('u1', 'How many leave days?');
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'fake' }),
      { feature: 'assistant', userId: 'u1' },
    );
  });

  it('streams meta → deltas → done, and the deltas add up to the saved answer', async () => {
    kb.search.mockResolvedValueOnce([policyChunk]);
    const events = [];
    for await (const e of await service.askStream('u1', 'How many leave days?'))
      events.push(e);
    expect(events[0]).toMatchObject({ type: 'meta', conversationId: 'conv-1' });
    const done = events.at(-1) as { type: string; answer: string };
    expect(done.type).toBe('done');
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((d) => (d as { text: string }).text).join('')).toBe(
      done.answer,
    );
  });

  it('a stream whose providers all fail ends with an error event', async () => {
    kb.search.mockResolvedValueOnce([policyChunk]);
    jest
      .spyOn(chat, 'complete')
      .mockRejectedValueOnce(
        new AllProvidersFailedError([{ provider: 'fake', error: 'down' }]),
      );
    const events = [];
    for await (const e of await service.askStream('u1', 'Leave?'))
      events.push(e);
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: expect.stringMatching(/temporarily unavailable/),
    });
  });

  it('answers without calling the model when nothing relevant is retrieved', async () => {
    const spy = jest.spyOn(chat, 'complete');
    const res = await service.ask('u1', 'What is the dress code?');
    expect(res).toMatchObject({
      answer: NOT_FOUND_ANSWER,
      grounded: false,
      provider: 'none',
      citations: [],
    });
    expect(spy).not.toHaveBeenCalled();
    expect(messages.save).toHaveBeenCalledTimes(2); // user turn + canned answer
  });

  it('grounds the prompt in retrieved chunks and keeps only cited references', async () => {
    kb.search.mockResolvedValue([
      {
        chunkId: 'c1',
        documentId: 'd1',
        title: 'Leave policy',
        chunkIndex: 0,
        content: 'Annual leave is 20 days.',
        similarity: 0.71,
      },
      {
        chunkId: 'c2',
        documentId: 'd2',
        title: 'Handbook',
        chunkIndex: 3,
        content: 'Dress smart-casual.',
        similarity: 0.31,
      },
    ]);
    const spy = jest.spyOn(chat, 'complete');

    const res = await service.ask('u1', 'How many leave days do I get?');

    const req = spy.mock.calls[0][0];
    expect(req.system).toContain('[1] "Leave policy"');
    expect(req.system).toContain('[2] "Handbook"');
    expect(req.messages.at(-1)).toEqual({
      role: 'user',
      content: 'How many leave days do I get?',
    });
    expect(res.grounded).toBe(true);
    expect(res.answer).toContain('[1]');
    expect(res.citations.map((c) => c.ref)).toEqual([1]); // fake model cited only [1]
    expect(res.citations[0]).toMatchObject({
      documentId: 'd1',
      title: 'Leave policy',
      similarity: 0.71,
    });
    expect(messages.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: AiMessageRole.ASSISTANT,
        provider: 'fake',
        citations: res.citations,
      }),
    );
  });

  it('replays recent history but never canned not-found answers', async () => {
    kb.search.mockResolvedValue([
      {
        chunkId: 'c1',
        documentId: 'd1',
        title: 'T',
        chunkIndex: 0,
        content: 'x',
        similarity: 0.5,
      },
    ]);
    messages.find.mockResolvedValue([
      Object.assign(new AiMessage(), {
        role: AiMessageRole.ASSISTANT,
        content: NOT_FOUND_ANSWER,
        provider: 'none',
      }),
      Object.assign(new AiMessage(), {
        role: AiMessageRole.USER,
        content: 'earlier question',
        provider: null,
      }),
    ]);
    const spy = jest.spyOn(chat, 'complete');
    await service.ask('u1', 'follow-up', 'conv-1');
    const turns = spy.mock.calls[0][0].messages;
    expect(turns.map((t) => t.content)).toEqual([
      'earlier question',
      'follow-up',
    ]);
  });

  it('maps a fully failed provider chain to 503 and refuses foreign conversations', async () => {
    kb.search.mockResolvedValue([
      {
        chunkId: 'c1',
        documentId: 'd1',
        title: 'T',
        chunkIndex: 0,
        content: 'x',
        similarity: 0.5,
      },
    ]);
    jest
      .spyOn(chat, 'complete')
      .mockRejectedValue(
        new AllProvidersFailedError([
          { provider: 'huggingface', error: 'down' },
        ]),
      );
    await expect(service.ask('u1', 'q')).rejects.toThrow(
      ServiceUnavailableException,
    );

    conversations.findOne.mockResolvedValue(
      Object.assign(new AiConversation(), {
        id: 'conv-1',
        userId: 'someone-else',
      }),
    );
    await expect(service.ask('u1', 'q', 'conv-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
