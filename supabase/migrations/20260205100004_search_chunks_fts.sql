-- Alexandria: RPC pour recherche full-text (lexicale) sur chunks
-- Utilisé pour la recherche hybride (fusion RRF avec match_chunks).

create or replace function public.search_chunks_fts(
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
    c.content,
    c.position,
    c.page,
    c.section_title,
    ts_rank_cd(c.content_tsv, plainto_tsquery('english', query_text))::float as rank,
    d.title as doc_title,
    d.doi as doc_doi,
    d.storage_path as doc_storage_path
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.status = 'done'
    and c.content_tsv is not null
    and query_text is not null
    and trim(query_text) <> ''
    and c.content_tsv @@ plainto_tsquery('english', query_text)
  order by rank desc
  limit match_limit;
$$;

comment on function public.search_chunks_fts is 'Recherche full-text (lexicale) sur chunks.content_tsv. Pour fusion RRF avec match_chunks.';
