import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AiConversation } from './ai-conversation.entity';

export enum AiMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

export interface Citation {
  /** 1-based index used in the answer text, e.g. "[2]". */
  ref: number;
  documentId: string;
  title: string;
  chunkIndex: number;
  similarity: number;
  excerpt: string;
}

@Entity({ name: 'ai_messages' })
export class AiMessage {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_ai_messages_conversation_id')
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => AiConversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: AiConversation;

  @ApiProperty({ enum: AiMessageRole })
  @Column({ type: 'enum', enum: AiMessageRole, enumName: 'ai_message_role' })
  role: AiMessageRole;

  @ApiProperty()
  @Column({ type: 'text' })
  content: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb', default: () => `'[]'` })
  citations: Citation[];

  @Column({ type: 'varchar', length: 30, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ name: 'input_tokens', type: 'int', nullable: true })
  inputTokens: number | null;

  @Column({ name: 'output_tokens', type: 'int', nullable: true })
  outputTokens: number | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
