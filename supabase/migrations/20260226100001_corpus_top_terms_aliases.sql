-- Alias explicites pour garantir word/nentry dans la réponse (compat client Supabase).
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
  select w as word, total as nentry from combined order by total desc limit lim;
$$;
