-- Alexandria: RPC de recherche de documents corpus similaires à un embedding donné.
--
-- Identique à match_chunks mais :
--   - filtre is_author_article = false (corpus seulement)
--   - agrège par document (best_similarity = max sim par doc)
--   - retourne des métadonnées doc, pas des chunks individuels
--
-- Utilisé par /api/corpus/author-articles/[id]/similar :
--   1. L'API route récupère l'embedding du 1er chunk de l'article auteur
--   2. Appelle cette RPC → index IVFFlat utilisé (même pattern que match_chunks)
--   3. Retourne les top N documents corpus les plus proches

create or replace function public.match_corpus_docs(
  query_embedding  vector(384),
  match_count      int   default 10,
  chunk_candidates int   default 80,
  match_threshold  float default 0.3
)
returns table (
  document_id     uuid,
  title           text,
  journal         text,
  published_at    date,
  doi             text,
  best_similarity float,
  best_chunk      text
)
language sql stable
as $$
  with top_chunks as (
    -- Cherche les chunk_candidates chunks les plus proches dans tout le corpus
    -- (IVFFlat est utilisé grâce au pattern ORDER BY <=> LIMIT dans une SQL function)
    select
      c.document_id,
      c.content,
      (1 - (c.embedding <=> query_embedding)) as sim
    from public.chunks c
    join public.documents d on d.id = c.document_id
    where d.is_author_article = false
      and d.status = 'done'
      and c.embedding is not null
      and (1 - (c.embedding <=> query_embedding)) > match_threshold
    order by c.embedding <=> query_embedding
    limit chunk_candidates
  )
  select
    d.id                                                          as document_id,
    d.title,
    d.journal,
    d.published_at,
    d.doi,
    max(tc.sim)                                                   as best_similarity,
    (array_agg(tc.content order by tc.sim desc))[1]              as best_chunk
  from   top_chunks tc
  join   public.documents d on d.id = tc.document_id
  group  by d.id, d.title, d.journal, d.published_at, d.doi
  order  by best_similarity desc
  limit  match_count;
$$;

comment on function public.match_corpus_docs is
  'Recherche de documents corpus similaires à un embedding (ex: chunk d''un article auteur).
   Exclut les articles auteur (is_author_article=false). Agrège par document.
   Utilise l''index IVFFlat via le pattern ORDER BY embedding <=> query LIMIT n.';
