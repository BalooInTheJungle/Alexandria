-- Alexandria: chunks (texte + FTS + embedding)
-- Dimension 1536 = OpenAI text-embedding-ada-002. Si tu passes en open source (ex. 384/768), alter après.

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  content text not null,
  position int not null,
  page int,
  section_title text,
  embedding vector(1536),
  content_tsv tsvector,
  created_at timestamptz not null default now()
);

create index if not exists idx_chunks_document_id on public.chunks (document_id);

-- FTS (anglais)
create index if not exists idx_chunks_content_tsv on public.chunks using gin (content_tsv);

-- Vector (ANN pour similarité). HNSW supporte table vide (ivfflat non).
create index if not exists idx_chunks_embedding on public.chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Trigger: maintenir content_tsv
create or replace function public.chunks_fts_trigger()
returns trigger language plpgsql as $$
begin
  new.content_tsv := to_tsvector('english', coalesce(new.content, ''));
  return new;
end;
$$;

drop trigger if exists chunks_fts on public.chunks;
create trigger chunks_fts
  before insert or update of content on public.chunks
  for each row execute function public.chunks_fts_trigger();

-- Initialiser tsv pour lignes existantes (si besoin)
update public.chunks set content_tsv = to_tsvector('english', coalesce(content, '')) where content_tsv is null;

comment on table public.chunks is 'Segments de documents pour RAG (FTS + pgvector).';
comment on column public.chunks.embedding is 'Dimension 1536 (OpenAI). Adapter si autre modèle.';
