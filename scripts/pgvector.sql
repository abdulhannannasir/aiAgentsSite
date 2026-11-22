-- Optional: faster semantic search with pgvector. AgentVerse works without this (embeddings are stored as plain
-- arrays and compared in the app); when the extension is installed, search automatically uses it.
--
-- Run once, as a role allowed to create extensions (on managed hosts: Neon, Railway, Render, RDS all ship pgvector):
--   psql "$DATABASE_URL" -f scripts/pgvector.sql
--
-- The index must match the dimensions of your embedding model: 1536 for OpenAI text-embedding-3-small (default),
-- 768 for Gemini (gemini-embedding-001 as configured here). Keep only the line for the model you use.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS memory_records_embedding_openai_idx
  ON memory_records USING hnsw (("embedding"::vector(1536)) vector_cosine_ops)
  WHERE "embeddingModel" = 'text-embedding-3-small';

-- CREATE INDEX IF NOT EXISTS memory_records_embedding_gemini_idx
--   ON memory_records USING hnsw (("embedding"::vector(768)) vector_cosine_ops)
--   WHERE "embeddingModel" = 'gemini-embedding-001';
