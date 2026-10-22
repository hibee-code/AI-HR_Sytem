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
 * (pgvector) is written and searched with raw SQL (KnowledgeBaseService); it
 * is mapped here only so schema diffs see it — never selected or written
 * through the repository.
 */
@Entity({ name: 'knowledge_chunks' })
@Index('idx_knowledge_chunks_document_id', ['documentId'])
// HNSW with vector_cosine_ops can't be expressed in decorators; owned by the migration.
@Index('idx_knowledge_chunks_embedding_hnsw', { synchronize: false })
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

  /** Dimension is fixed by the AiKnowledgeBase migration (EMBEDDING_DIMENSIONS must match). */
  @Column({
    type: 'vector',
    length: 384,
    select: false,
    insert: false,
    update: false,
  })
  embedding?: number[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
