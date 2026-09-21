import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import { IsNull, Repository } from 'typeorm';
import type { Env } from '../../config/env.schema';
import { EMBEDDINGS_PROVIDER } from '../../infrastructure/ai/embeddings.interface';
import type { EmbeddingsProvider } from '../../infrastructure/ai/embeddings.interface';
import { STORAGE_SERVICE } from '../../infrastructure/storage/storage.interface';
import type { StorageService } from '../../infrastructure/storage/storage.interface';
import {
  Document,
  DocumentCategory,
  DocumentVisibility,
} from '../documents/entities/document.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import {
  chunkText,
  extractText,
  UnsupportedContentError,
} from './text-extraction';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  title: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

export interface IndexResult {
  documentId: string;
  action: 'indexed' | 'removed' | 'skipped';
  chunks: number;
  reason?: string;
}

/** Embedding batch size sent to the provider per call. */
const EMBED_BATCH = 32;

/**
 * Ingests eligible documents (COMPANY-visible POLICY, not deleted) into
 * pgvector and answers similarity queries. Ineligible documents that were
 * indexed earlier get their chunks removed on the next pass.
 */
@Injectable()
export class KnowledgeBaseService {
  private readonly topK: number;
  private readonly floor: number;

  constructor(
    @InjectRepository(KnowledgeChunk)
    private readonly chunks: Repository<KnowledgeChunk>,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    @Inject(EMBEDDINGS_PROVIDER)
    private readonly embeddings: EmbeddingsProvider,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly logger: Logger,
    config: ConfigService<Env, true>,
  ) {
    this.topK = config.get('AI_RETRIEVAL_TOP_K', { infer: true });
    this.floor = config.get('AI_SIMILARITY_FLOOR', { infer: true });
  }

  static isEligible(doc: Document | null): doc is Document {
    return (
      !!doc &&
      !doc.deletedAt &&
      doc.category === DocumentCategory.POLICY &&
      doc.visibility === DocumentVisibility.COMPANY &&
      !!doc.currentVersion
    );
  }

  // ── Indexing ──────────────────────────────────────────────────────────

  /** Re-evaluates one document: (re)index it, or drop stale chunks if no longer eligible. */
  async indexDocument(documentId: string): Promise<IndexResult> {
    const doc = await this.documents.findOne({
      where: { id: documentId },
      withDeleted: true,
      relations: { currentVersion: true },
    });
    if (!KnowledgeBaseService.isEligible(doc)) {
      const removed = await this.chunks.delete({ documentId });
      return {
        documentId,
        action: removed.affected ? 'removed' : 'skipped',
        chunks: 0,
        reason: 'not an active company policy',
      };
    }
    const version = doc.currentVersion!;

    let text: string;
    try {
      const bytes = await this.storage.download(
        version.storageKey,
        version.resourceType,
      );
      text = await extractText(bytes, version.mimeType);
    } catch (err) {
      if (err instanceof UnsupportedContentError) {
        return {
          documentId,
          action: 'skipped',
          chunks: 0,
          reason: err.message,
        };
      }
      throw err;
    }

    const pieces = await chunkText(text);
    const vectors: number[][] = [];
    for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
      vectors.push(
        ...(await this.embeddings.embed(
          pieces.slice(i, i + EMBED_BATCH).map((p) => p.content),
        )),
      );
    }

    await this.chunks.manager.transaction(async (em) => {
      await em.delete(KnowledgeChunk, { documentId });
      for (let i = 0; i < pieces.length; i++) {
        await em.query(
          `INSERT INTO knowledge_chunks
             (document_id, document_version_id, chunk_index, content, token_estimate, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)`,
          [
            documentId,
            version.id,
            pieces[i].index,
            pieces[i].content,
            pieces[i].tokenEstimate,
            JSON.stringify({ title: doc.title }),
            toVectorLiteral(vectors[i]),
          ],
        );
      }
      await em.update(Document, documentId, { kbIndexedAt: new Date() });
    });

    this.logger.log(
      { documentId, chunks: pieces.length },
      'document indexed into knowledge base',
    );
    return { documentId, action: 'indexed', chunks: pieces.length };
  }

  /** Ids of every document the KB should contain; used for bulk reindex. */
  async eligibleDocumentIds(): Promise<string[]> {
    const rows = await this.documents.find({
      where: {
        category: DocumentCategory.POLICY,
        visibility: DocumentVisibility.COMPANY,
        deletedAt: IsNull(),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Eligible documents whose current version isn't indexed yet (or was invalidated). */
  async staleDocumentIds(): Promise<string[]> {
    const rows = await this.documents.find({
      where: {
        category: DocumentCategory.POLICY,
        visibility: DocumentVisibility.COMPANY,
        deletedAt: IsNull(),
        kbIndexedAt: IsNull(),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async status(): Promise<{
    documents: number;
    chunks: number;
    stale: number;
    embeddingModel: string;
    dimensions: number;
  }> {
    const [documents, chunks, stale] = await Promise.all([
      this.chunks
        .createQueryBuilder('c')
        .select('COUNT(DISTINCT c.document_id)', 'n')
        .getRawOne<{ n: string }>(),
      this.chunks.count(),
      this.staleDocumentIds(),
    ]);
    return {
      documents: Number(documents?.n ?? 0),
      chunks,
      stale: stale.length,
      embeddingModel: this.embeddings.model,
      dimensions: this.embeddings.dimensions,
    };
  }

  // ── Retrieval ─────────────────────────────────────────────────────────

  async search(
    query: string,
    k = this.topK,
    floor = this.floor,
  ): Promise<RetrievedChunk[]> {
    const [vector] = await this.embeddings.embed([query]);
    const rows: {
      id: string;
      document_id: string;
      chunk_index: number;
      content: string;
      metadata: { title: string };
      similarity: string;
    }[] = await this.chunks.query(
      `SELECT c.id, c.document_id, c.chunk_index, c.content, c.metadata,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM knowledge_chunks c
         JOIN documents d ON d.id = c.document_id AND d.deleted_at IS NULL
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
      [toVectorLiteral(vector), k],
    );
    return rows
      .map((r) => ({
        chunkId: r.id,
        documentId: r.document_id,
        title: r.metadata?.title ?? 'Untitled',
        chunkIndex: r.chunk_index,
        content: r.content,
        similarity: Number(r.similarity),
      }))
      .filter((r) => r.similarity >= floor);
  }

  async assertDocumentExists(id: string): Promise<void> {
    if (!(await this.documents.exists({ where: { id }, withDeleted: true })))
      throw new NotFoundException('Document not found');
  }
}

/** pgvector text literal: "[0.1,0.2,...]" */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(8) : 0)).join(',')}]`;
}
