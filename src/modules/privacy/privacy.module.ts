import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { RetentionProcessor } from './retention.processor';
import { RetentionService } from './retention.service';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.PRIVACY }),
    DocumentsModule,
  ],
  controllers: [PrivacyController],
  providers: [PrivacyService, RetentionService, RetentionProcessor],
})
export class PrivacyModule {}
