-- Multilingual embeddings: widen the chunk vector from 384 to 1024 dims.
--
-- We swapped the local embedding model from BAAI/bge-small-en-v1.5 (384-dim,
-- English-only) to jinaai/jina-embeddings-v3 (1024-dim, multilingual) so that
-- (a) the scope-gate triage can compare German emails against English anchor
-- phrases cross-lingually, and (b) search keeps working once email content is
-- translated to English at comprehend time.
--
-- Old 384-dim vectors cannot be cast to 1024 dims, and every embedding is
-- recomputed locally right after this migration (python -m src.reinit, or a
-- fresh comprehend run), so we simply drop and re-add the column. Dropping the
-- column also drops the dependent HNSW index; we recreate it on the new column.
ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding VECTOR(1024);  -- jina-embeddings-v3 dim

CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);
