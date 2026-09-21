import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { AiMessage } from './ai-message.entity';

@Entity({ name: 'ai_conversations' })
export class AiConversation extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Index('idx_ai_conversations_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** First user message, trimmed — for listing. */
  @ApiProperty()
  @Column({ type: 'varchar', length: 120 })
  title: string;

  @OneToMany(() => AiMessage, (m) => m.conversation)
  messages: AiMessage[];
}
