-- Augmenter le timeout pour get_corpus_top_terms (ts_stat sur 35k+ chunks peut dépasser 8s).
create or replace function public.get_corpus_top_terms(lim int default 80)
returns table(word text, nentry bigint)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  set local statement_timeout = '60000';
  return query
  with en as (
    select t.word::text as w, t.nentry as n
    from ts_stat('select content_tsv from chunks where content_tsv is not null') t
    where length(t.word::text) >= 3
  ),
  fr as (
    select t.word::text as w, t.nentry as n
    from ts_stat('select content_fr_tsv from chunks where content_fr_tsv is not null') t
    where length(t.word::text) >= 3
  ),
  merged as (
    select u.w, sum(u.n)::bigint as total from (
      select w, n from en
      union all
      select w, n from fr
    ) u group by u.w
  )
  select m.w::text, m.total from merged m order by m.total desc limit lim;
end;
$$;
