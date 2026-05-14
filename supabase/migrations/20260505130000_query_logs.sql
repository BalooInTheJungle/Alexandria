-- Logs des requêtes RAG : permet d'analyser le comportement du chercheur.
-- Chaque requête posée au chat RAG génère une ligne.

create table if not exists public.query_logs (
  id uuid primary key default gen_random_uuid(),
  query_text text not null,
  lang text not null default 'en' check (lang in ('fr', 'en')),
  chunks_retrieved int not null default 0,
  best_similarity float,
  was_guardrailed boolean not null default false,
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_query_logs_created_at on public.query_logs (created_at desc);
create index if not exists idx_query_logs_lang on public.query_logs (lang);

-- RLS : lecture publique (pas d'auth sur ce projet), pas d'écriture publique.
alter table public.query_logs enable row level security;

create policy "query_logs_select" on public.query_logs
  for select using (true);

-- RPC : stats agrégées par jour (pour heatmap et courbe d'activité).
create or replace function public.get_query_stats_daily(days_back int default 30)
returns table(day date, total bigint, guardrailed bigint, lang_fr bigint, lang_en bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    date_trunc('day', created_at)::date as day,
    count(*) as total,
    count(*) filter (where was_guardrailed) as guardrailed,
    count(*) filter (where lang = 'fr') as lang_fr,
    count(*) filter (where lang = 'en') as lang_en
  from query_logs
  where created_at >= now() - (days_back || ' days')::interval
  group by day
  order by day;
$$;

comment on table public.query_logs is 'Log de chaque requête RAG : comportement chercheur, langue, similarité, garde-fou.';
