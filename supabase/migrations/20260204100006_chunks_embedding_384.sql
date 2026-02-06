-- Alexandria: embeddings en 384 (sentence-transformers all-MiniLM-L6-v2)
-- pgvector ne permet pas de changer la dimension en place : on recrée la colonne.
-- Si tu as déjà des chunks, ils seront perdus (ré-ingérer après).

drop index if exists public.idx_chunks_embedding;
alter table public.chunks drop column if exists embedding;
alter table public.chunks add column embedding vector(384);

create index if not exists idx_chunks_embedding on public.chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on column public.chunks.embedding is 'Dimension 384 (sentence-transformers all-MiniLM-L6-v2).';
