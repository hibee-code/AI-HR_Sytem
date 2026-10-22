import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiInfrastructureModule } from '../../infrastructure/ai/ai.module';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { Document } from '../documents/entities/document.entity';
import { RbacModule } from '../rbac/rbac.module';
import { AiUsageService } from './ai-usage.service';
import { AiController } from './ai.controller';
import { AiListener } from './ai.listener';
import { AiProcessor } from './ai.processor';
import { AssistantService } from './assistant.service';
import { AiConversation } from './entities/ai-conversation.entity';
import { AiMessage } from './entities/ai-message.entity';
import { AiUsage } from './entities/ai-usage.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeBaseService } from './knowledge-base.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeChunk,
      AiConversation,
      AiMessage,
      AiUsage,
      Document,
    ]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.AI }),
    AiInfrastructureModule,
    StorageModule,
    RbacModule,
  ],
  controllers: [AiController],
  providers: [
    KnowledgeBaseService,
    AssistantService,
    AiUsageService,
    AiProcessor,
    AiListener,
  ],
  exports: [KnowledgeBaseService, AssistantService, AiUsageService],
})
export class AiModule {}
