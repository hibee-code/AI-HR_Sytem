import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../../common/typeorm/numeric.transformer';

export enum AiFeature {
  ASSISTANT = 'assistant',
  SCREENING = 'screening',
}

/** One row per model call: who, which feature, which model, tokens, estimated cost. */
@Entity({ name: 'ai_usage' })
@Index('idx_ai_usage_user_created', ['userId', 'createdAt'])
@Index('idx_ai_usage_created', ['createdAt'])
export class AiUsage {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** null for system work (e.g. résumé screening jobs). */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 30 })
  feature: AiFeature;

  @Column({ type: 'varchar', length: 30 })
  provider: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens: number;

  @Column({
    name: 'cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  costUsd: number | null;
}
