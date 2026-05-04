-- Cache des termes du corpus : évite ts_stat à chaque run (timeout Supabase).
-- À peupler manuellement ou via cron. La RPC lit ce cache.

create table if not exists public.corpus_top_terms_cache (
  word text primary key,
  nentry bigint not null,
  updated_at timestamptz not null default now()
);

-- RPC rapide : lit le cache (pas de ts_stat = pas de timeout).
create or replace function public.get_corpus_top_terms(lim int default 80)
returns table(word text, nentry bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.word, c.nentry from corpus_top_terms_cache c order by c.nentry desc limit lim;
$$;

-- Fonction pour peupler le cache (à lancer manuellement si timeout).
-- Exemple: SELECT refresh_corpus_top_terms();
create or replace function public.refresh_corpus_top_terms()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  truncate corpus_top_terms_cache;
  insert into corpus_top_terms_cache (word, nentry)
  with en as (
    select t.word::text as w, t.nentry as n
    from ts_stat('select content_tsv from chunks where content_tsv is not null limit 15000') t
    where length(t.word::text) >= 3
  ),
  fr as (
    select t.word::text as w, t.nentry as n
    from ts_stat('select content_fr_tsv from chunks where content_fr_tsv is not null limit 15000') t
    where length(t.word::text) >= 3
  ),
  merged as (
    select u.w, sum(u.n)::bigint as total from (
      select w, n from en union all select w, n from fr
    ) u group by u.w
  )
  select m.w, m.total from merged m;
end;
$$;

comment on table public.corpus_top_terms_cache is 'Cache des termes fréquents du corpus. Peupler avec SELECT refresh_corpus_top_terms();';
