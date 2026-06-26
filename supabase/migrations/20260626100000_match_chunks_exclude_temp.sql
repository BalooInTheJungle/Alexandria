-- Exclure les chunks temporaires (is_temp=true) du scoring corpus.
-- Sans ce filtre, un document uploadé en analyse matchait contre ses propres chunks
-- is_temp=true, gonflant artificiellement le score de similarité.
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 20
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  content text,
  "position" integer,
  page integer,
  section_title text,
  similarity double precision,
  doc_title text,
  doc_doi text,
  doc_storage_path text
)
LANGUAGE sql
STABLE
AS $function$
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
    and c.is_temp = false
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$function$;
