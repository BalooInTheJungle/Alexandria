-- Add pipeline_logs column to veille_runs
-- Stores key pipeline events: phase transitions, errors, metrics
-- Format: [{ts, level, phase, msg}]

alter table public.veille_runs
  add column if not exists pipeline_logs jsonb not null default '[]'::jsonb;
