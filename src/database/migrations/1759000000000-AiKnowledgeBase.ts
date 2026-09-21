import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 9: knowledge-base chunks with a pgvector embedding column, and
 * assistant conversations. The vector dimension is fixed here (384 =
 * sentence-transformers/all-MiniLM-L6-v2); changing the embedding model to a
 * different size needs a new migration that alters the column and reindexes.
 */
export class AiKnowledgeBase1759000000000 implements MigrationInterface {
  name = 'AiKnowledgeBase1759000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TYPE "ai_message_role" AS ENUM ('USER', 'ASSISTANT')`,
    );

    await q.query(`
      CREATE TABLE "knowledge_chunks" (
        "id"                  uuid NOT NULL DEFAULT gen_random_uuid(),
        "document_id"         uuid NOT NULL,
        "document_version_id" uuid NOT NULL,
        "chunk_index"         integer NOT NULL,
        "content"             text NOT NULL,
        "token_estimate"      integer NOT NULL,
        "metadata"            jsonb NOT NULL DEFAULT '{}',
        "embedding"           vector(384) NOT NULL,
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_81af684d79d321813c41019a5cd" PRIMARY KEY ("id"),
        CONSTRAINT "FK_2089ee83745a2f45c4f97faf2a5" FOREIGN KEY ("document_id")
          REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_knowledge_chunks_document_id" ON "knowledge_chunks" ("document_id")`,
    );
    // Approximate nearest-neighbour index for cosine distance (<=>).
    await q.query(
      `CREATE INDEX "idx_knowledge_chunks_embedding_hnsw" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops)`,
    );

    await q.query(`
      CREATE TABLE "ai_conversations" (
        "id"         uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "user_id"    uuid NOT NULL,
        "title"      varchar(120) NOT NULL,
        CONSTRAINT "PK_60db12765b82858ba00c8aa4ae2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_12fdbf99ca0da93085d61edd3bb" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_ai_conversations_user_id" ON "ai_conversations" ("user_id")`,
    );

    await q.query(`
      CREATE TABLE "ai_messages" (
        "id"              uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        "role"            "ai_message_role" NOT NULL,
        "content"         text NOT NULL,
        "citations"       jsonb NOT NULL DEFAULT '[]',
        "provider"        varchar(30),
        "model"           varchar(100),
        "input_tokens"    integer,
        "output_tokens"   integer,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_a390434d4a515ba18a41bc996c2" PRIMARY KEY ("id"),
        CONSTRAINT "FK_de21fcb2d1df7fd6ca70f555b6d" FOREIGN KEY ("conversation_id")
          REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`);
    await q.query(
      `CREATE INDEX "idx_ai_messages_conversation_id" ON "ai_messages" ("conversation_id")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "ai_messages"`);
    await q.query(`DROP TABLE "ai_conversations"`);
    await q.query(`DROP TABLE "knowledge_chunks"`);
    await q.query(`DROP TYPE "ai_message_role"`);
  }
}
