-- Resize chunk embeddings from 1024 dims (jina-v3) to 384 dims (multilingual-e5-small).
--
-- We're swapping the local embedding model from jinaai/jina-embeddings-v3
-- (1024-dim, ~560 MB ONNX, ~3 GB peak RAM) to intfloat/multilingual-e5-small
-- (384-dim, ~120 MB ONNX, ~300 MB peak RAM). Both are multilingual so
-- cross-lingual scope-gate triage (German email vs English anchor) still works.
--
-- Old 1024-dim vectors cannot be cast to 384 dims. Since no embeddings exist
-- in production yet (backfill never completed while jina-v3 was active), we
-- simply drop and re-add the column. The dependent HNSW index drops with the
-- column and is recreated on the new column.
ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding VECTOR(384);  -- multilingual-e5-small dim

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
