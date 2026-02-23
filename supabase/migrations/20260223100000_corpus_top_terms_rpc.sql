-- RPC : termes les plus fréquents du corpus (chunks) pour le score heuristique veille.
-- Utilise ts_stat sur content_tsv (EN) et content_fr_tsv (FR) pour extraire les lexèmes.

create or replace function public.get_corpus_top_terms(lim int default 80)
returns table(word text, nentry bigint)
language sql
stable
security definer
set search_path = public
as $$
  with en as (
    select word::text as w, nentry
    from ts_stat('select content_tsv from chunks where content_tsv is not null')
    where length(word::text) >= 3
  ),
  fr as (
    select word::text as w, nentry
    from ts_stat('select content_fr_tsv from chunks where content_fr_tsv is not null')
    where length(word::text) >= 3
  ),
  combined as (
    select w, sum(nentry) as total from (
      select w, nentry from en
      union all
      select w, nentry from fr
    ) u group by w
  )
  select w, total from combined order by total desc limit lim;
$$;

comment on function public.get_corpus_top_terms is 'Termes les plus fréquents du corpus (chunks EN+FR) pour score heuristique veille.';
