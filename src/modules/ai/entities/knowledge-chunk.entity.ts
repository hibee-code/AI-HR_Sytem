import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Document } from '../../documents/entities/document.entity';

/**
 * A slice of a company document with its embedding. The `embedding` column
 * (pgvector) is created by the migration and read/written with raw SQL —
 * TypeORM has no native vector type, so it is deliberately absent here.
 */
@Entity({ name: 'knowledge_chunks' })
@Index('idx_knowledge_chunks_document_id', ['documentId'])
export class KnowledgeChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ name: 'document_version_id', type: 'uuid' })
  documentVersionId: string;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex: number;

  @Column({ type: 'text' })
  content: string;

  /** Rough size for budgeting the prompt (chars / 4). */
  @Column({ name: 'token_estimate', type: 'int' })
  tokenEstimate: number;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: { title: string; page?: number };

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
