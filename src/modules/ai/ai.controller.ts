import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CHAT_MODEL } from '../../infrastructure/ai/chat-model.interface';
import { FallbackChatModel } from '../../infrastructure/ai/fallback-chat-model';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { AiUsageService } from './ai-usage.service';
import { AiProcessor } from './ai.processor';
import { AssistantService } from './assistant.service';
import {
  ChatDto,
  ReindexDto,
  SearchQueryDto,
  UsageQueryDto,
} from './dto/ai.dto';
import { KnowledgeBaseService } from './knowledge-base.service';
import { AiConversation } from './entities/ai-conversation.entity';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';

@ApiTags('ai')
@ApiBearerAuth('access-token')
@Controller('ai')
export class AiController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly kb: KnowledgeBaseService,
    private readonly processor: AiProcessor,
    private readonly usage: AiUsageService,
    @Inject(CHAT_MODEL) private readonly chain: FallbackChatModel,
  ) {}

  // ── Assistant ─────────────────────────────────────────────────────────

  @Post('assistant/chat')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Ask the HR assistant; answers are grounded in company policies with citations',
  })
  chat(@Body() dto: ChatDto, @CurrentUser('id') userId: string) {
    return this.assistant.ask(userId, dto.message, dto.conversationId);
  }

  @Post('assistant/chat/stream')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Same as /assistant/chat, streamed as server-sent events',
    description:
      'Events in order: `meta` {conversationId, citations} → `delta` {text} (repeated) → `done` {…ChatResult} or `error` {message}. Read with fetch() + a stream reader (EventSource cannot POST).',
  })
  async chatStream(
    @Body() dto: ChatDto,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ): Promise<void> {
    // Throws (404/403/429) before any byte is written → normal JSON errors.
    const events = await this.assistant.askStream(
      userId,
      dto.message,
      dto.conversationId,
    );
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
    });
    res.flushHeaders();
    // Tab closed / network dropped: leaving the loop cancels generation.
    let gone = false;
    res.on('close', () => (gone = !res.writableFinished));
    for await (const { type, ...data } of events) {
      if (gone) break;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    if (!gone) res.end();
  }

  @Get('usage/me')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
  @ApiOperation({ summary: 'Assistant questions used today and the daily cap' })
  myUsage(@CurrentUser('id') userId: string) {
    return this.usage.today(userId);
  }

  @Get('usage')
  @RequirePermissions(PERMISSIONS.AI_READ_USAGE)
  @ApiOperation({
    summary: 'Calls, tokens and estimated USD cost per day / feature / model',
  })
  usageReport(@Query() query: UsageQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    return this.usage.summary(from, to);
  }

  @Get('assistant/conversations')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
  @ApiPaginatedResponse(AiConversation)
  conversations(
    @Query() query: PaginationQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.assistant.listConversations(userId, query);
  }

  @Get('assistant/conversations/:id')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
  conversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assistant.getConversation(id, userId);
  }

  @Delete('assistant/conversations/:id')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.assistant.deleteConversation(id, userId);
  }

  // ── Knowledge base (HR) ───────────────────────────────────────────────

  @Get('knowledge-base/status')
  @RequirePermissions(PERMISSIONS.AI_MANAGE_KNOWLEDGE_BASE)
  async status() {
    return {
      ...(await this.kb.status()),
      chatProviders: {
        configured: this.chain.configured,
        coolingDown: this.chain.unhealthy,
      },
    };
  }

  @Post('knowledge-base/reindex')
  @RequirePermissions(PERMISSIONS.AI_MANAGE_KNOWLEDGE_BASE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue (re)indexing of one document or every eligible policy',
  })
  async reindex(@Body() dto: ReindexDto) {
    if (dto.documentId) {
      await this.kb.assertDocumentExists(dto.documentId);
      await this.processor.enqueueIndex(dto.documentId);
      return { queued: 1 };
    }
    return { queued: await this.processor.enqueueAll() };
  }

  @Get('knowledge-base/search')
  @RequirePermissions(PERMISSIONS.AI_MANAGE_KNOWLEDGE_BASE)
  @ApiOperation({
    summary: 'Raw similarity search (debugging retrieval quality)',
  })
  search(@Query() query: SearchQueryDto) {
    return this.kb.search(query.q);
  }
}
