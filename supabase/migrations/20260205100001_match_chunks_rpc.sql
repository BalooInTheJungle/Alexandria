-- Alexandria: RPC pour recherche vectorielle (cosine) sur chunks (384D)
-- Retourne les chunks avec infos document pour les citations.

create or replace function public.match_chunks(
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
    c.content,
    c.position,
    c.page,
    c.section_title,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.title as doc_title,
    d.doi as doc_doi,
    d.storage_path as doc_storage_path
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'done'
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_chunks is 'Recherche par similarité cosinus sur chunks (embedding 384D). Retourne chunks + métadonnées document pour citations.';
