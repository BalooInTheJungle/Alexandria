-- Table pour stocker les URLs à traiter par run (traitement par lots).
create table if not exists public.veille_run_urls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.veille_runs (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete restrict,
  url text not null,
  position int not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'skipped')),
  created_at timestamptz not null default now()
);

create index if not exists idx_veille_run_urls_run_pending
  on public.veille_run_urls (run_id, position)
  where status = 'pending';

comment on table public.veille_run_urls is 'URLs à traiter par run, pour traitement par lots (éviter timeout Vercel).';
