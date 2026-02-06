-- Alexandria P1: colonnes français (content_fr, embedding_fr, content_fr_tsv)
-- + trigger FTS french, index, RPC match_chunks_fr et search_chunks_fts_fr.

-- Colonnes
alter table public.chunks
  add column if not exists content_fr text,
  add column if not exists embedding_fr vector(384),
  add column if not exists content_fr_tsv tsvector;

-- Trigger FTS français
create or replace function public.chunks_fts_fr_trigger()
returns trigger language plpgsql as $$
begin
  new.content_fr_tsv := to_tsvector('french', coalesce(new.content_fr, ''));
  return new;
end;
$$;

drop trigger if exists chunks_fts_fr on public.chunks;
create trigger chunks_fts_fr
  before insert or update of content_fr on public.chunks
  for each row execute function public.chunks_fts_fr_trigger();

-- Index GIN FTS français
create index if not exists idx_chunks_content_fr_tsv on public.chunks using gin (content_fr_tsv);

-- Index HNSW sur embedding_fr
create index if not exists idx_chunks_embedding_fr on public.chunks
  using hnsw (embedding_fr vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- RPC recherche vectorielle FR (retourne content_fr comme content pour cohérence type)
create or replace function public.match_chunks_fr(
  query_embedding vector(384),
  match_threshold float default 0.5,
  match_count int default 20
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  "position" int,
  page int,
  section_title text,
  similarity float,
  doc_title text,
  doc_doi text,
  doc_storage_path text
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.content_fr as content,
    c.position,
    c.page,
    c.section_title,
    1 - (c.embedding_fr <=> query_embedding) as similarity,
    d.title as doc_title,
    d.doi as doc_doi,
    d.storage_path as doc_storage_path
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'done'
    and c.embedding_fr is not null
    and (1 - (c.embedding_fr <=> query_embedding)) > match_threshold
  order by c.embedding_fr <=> query_embedding
  limit match_count;
$$;

comment on function public.match_chunks_fr is 'Recherche par similarité cosinus sur chunks (embedding_fr 384D). Retourne content_fr comme content.';

-- RPC recherche FTS français (plainto_tsquery french)
create or replace function public.search_chunks_fts_fr(
  query_text text,
  match_limit int default 20
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  "position" int,
  page int,
  section_title text,
  rank float,
  doc_title text,
  doc_doi text,
  doc_storage_path text
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.content_fr as content,
    c.position,
    c.page,
    c.section_title,
    ts_rank_cd(c.content_fr_tsv, plainto_tsquery('french', query_text))::float as rank,
    d.title as doc_title,
    d.doi as doc_doi,
    d.storage_path as doc_storage_path
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'done'
    and c.content_fr_tsv is not null
    and query_text is not null
    and trim(query_text) <> ''
    and c.content_fr_tsv @@ plainto_tsquery('french', query_text)
  order by rank desc
  limit match_limit;
$$;

comment on function public.search_chunks_fts_fr is 'Recherche full-text (lexicale) sur chunks.content_fr_tsv (config french). Pour fusion RRF avec match_chunks_fr.';
