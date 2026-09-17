-- Runs once when the Postgres data volume is first created.
-- The app's first migration also does this (idempotently), but enabling the
-- extensions here means a fresh DB is RAG-ready even before migrations run.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "vector";
