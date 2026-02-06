-- Alexandria: veille_runs + veille_items
-- Dédup par DOI/URL géré en app (pas de UNIQUE contrainte pour permettre plusieurs runs).

create table if not exists public.veille_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.veille_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.veille_runs (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete restrict,
  url text not null,
  title text,
  authors text[],
  doi text,
  abstract text,
  published_at date,
  similarity_score real,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_veille_items_run_id on public.veille_items (run_id);
create index if not exists idx_veille_items_source_id on public.veille_items (source_id);
create index if not exists idx_veille_items_doi on public.veille_items (doi) where doi is not null;
create index if not exists idx_veille_items_url on public.veille_items (url);

comment on table public.veille_runs is 'Une run = toutes les sources d''un coup.';
comment on table public.veille_items is 'Articles récupérés par la veille. Dédup DOI/URL en app (guardrails).';
comment on column public.veille_items.last_error is 'Log d''erreur (skip + log) pour le POC.';
