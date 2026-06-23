create or replace function public.match_author_chunks(
  query_embedding vector(384),
  match_threshold float default 0.0,
  match_count int default 3
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  "position" int,
  page int,
  similarity float,
  doc_title text
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    c.content,
    c.position,
    c.page,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.title as doc_title
  from public.chunks c
  join public.documents d on d.id = c.document_id
  where d.is_author_article = true
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_author_chunks is 'Recherche par similarité cosinus uniquement sur les chunks des articles auteur (is_author_article=true). Utilisé pour le score de pertinence profil chercheur.';
