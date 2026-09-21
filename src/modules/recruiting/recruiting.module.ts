import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiInfrastructureModule } from '../../infrastructure/ai/ai.module';
import { QUEUES } from '../../infrastructure/queue/queue.constants';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { DocumentsModule } from '../documents/documents.module';
import { Department } from '../employees/entities/department.entity';
import { Position } from '../employees/entities/position.entity';
import { Application } from './entities/application.entity';
import { Candidate } from './entities/candidate.entity';
import { JobOpening } from './entities/job-opening.entity';
import { RecruitingController } from './recruiting.controller';
import { RecruitingProcessor } from './recruiting.processor';
import { RecruitingService } from './recruiting.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobOpening,
      Candidate,
      Application,
      Department,
      Position,
    ]),
    QueueModule,
    BullModule.registerQueue({ name: QUEUES.RECRUITING }),
    AiInfrastructureModule,
    StorageModule,
    DocumentsModule,
  ],
  controllers: [RecruitingController],
  providers: [RecruitingService, RecruitingProcessor],
  exports: [RecruitingService],
})
export class RecruitingModule {}
