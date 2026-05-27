-- Alexandria: RPC pour comparer un article auteur avec le corpus général.
--
-- Stratégie :
--   1. Calcule l'embedding moyen de tous les chunks de l'article auteur.
--   2. Cherche les 200 chunks les plus proches dans TOUT le corpus (index IVFFlat).
--   3. Filtre pour ne garder que les documents corpus (is_author_article = false).
--   4. Agrège par document : best_similarity = max(sim), best_chunk = chunk le plus proche.
--   5. Retourne les match_count documents les plus similaires.
--
-- Le surééchantillonnage (200 chunks → ~170 corpus après exclusion ~13% articles auteur)
-- garantit d'avoir assez de résultats même après le filtre.

create or replace function public.match_corpus_by_author_doc(
  author_doc_id  uuid,
  match_count    int   default 10
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
language plpgsql stable
as $$
declare
  avg_emb vector(384);
begin
  -- 1. Embedding moyen de l'article auteur
  select avg(c.embedding)::vector(384)
    into avg_emb
  from public.chunks c
  where c.document_id = author_doc_id
    and c.embedding is not null;

  if avg_emb is null then
    return;  -- pas de chunks ou pas d'embeddings
  end if;

  -- 2. Top 200 chunks proches (index IVFFlat) → filtrer corpus → agréger par doc
  return query
  with top_chunks as (
    select
      c.document_id,
      c.content,
      (1 - (c.embedding <=> avg_emb)) as sim
    from public.chunks c
    where c.embedding is not null
    order by c.embedding <=> avg_emb
    limit 200
  ),
  corpus_chunks as (
    select tc.document_id, tc.content, tc.sim
    from   top_chunks tc
    join   public.documents d on d.id = tc.document_id
    where  d.is_author_article = false
      and  d.status = 'done'
  )
  select
    d.id                                                                     as document_id,
    d.title,
    d.journal,
    d.published_at,
    d.doi,
    max(cc.sim)                                                              as best_similarity,
    (array_agg(cc.content order by cc.sim desc))[1]                         as best_chunk
  from   corpus_chunks cc
  join   public.documents d on d.id = cc.document_id
  group  by d.id, d.title, d.journal, d.published_at, d.doi
  order  by best_similarity desc
  limit  match_count;
end;
$$;

comment on function public.match_corpus_by_author_doc is
  'Compare un article auteur (by id) au corpus général via embedding moyen.
   Retourne les match_count documents corpus les plus similaires avec leur meilleur chunk.';
