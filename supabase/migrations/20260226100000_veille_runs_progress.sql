-- Colonnes de progression pour la veille (phase + items).

alter table public.veille_runs
  add column if not exists phase text,
  add column if not exists items_processed int not null default 0,
  add column if not exists items_total int;

comment on column public.veille_runs.phase is 'Phase courante: sources, urls, filter, items, done';
comment on column public.veille_runs.items_processed is 'Nombre d''articles traités (phase items)';
comment on column public.veille_runs.items_total is 'Nombre total d''articles à traiter (phase items)';
