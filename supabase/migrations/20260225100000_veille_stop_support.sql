-- Support arrêt manuel de la veille : status stopped + abort_requested.

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.veille_runs'::regclass and contype = 'c'
  loop
    execute format('alter table public.veille_runs drop constraint %I', c);
  end loop;
end $$;

alter table public.veille_runs
  add constraint veille_runs_status_check
  check (status in ('pending', 'running', 'completed', 'failed', 'stopped'));

alter table public.veille_runs
  add column if not exists abort_requested boolean not null default false;

comment on column public.veille_runs.abort_requested is 'Demande d''arrêt par l''utilisateur ; la pipeline vérifie avant chaque item.';
