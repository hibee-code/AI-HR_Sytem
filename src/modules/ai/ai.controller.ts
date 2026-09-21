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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CHAT_MODEL } from '../../infrastructure/ai/chat-model.interface';
import { FallbackChatModel } from '../../infrastructure/ai/fallback-chat-model';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { AiProcessor } from './ai.processor';
import { AssistantService } from './assistant.service';
import { ChatDto, ReindexDto, SearchQueryDto } from './dto/ai.dto';
import { KnowledgeBaseService } from './knowledge-base.service';

@ApiTags('ai')
@ApiBearerAuth('access-token')
@Controller('ai')
export class AiController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly kb: KnowledgeBaseService,
    private readonly processor: AiProcessor,
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

  @Get('assistant/conversations')
  @RequirePermissions(PERMISSIONS.AI_CHAT)
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
