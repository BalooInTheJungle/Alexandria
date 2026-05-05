-- Résumé IA et comptage articles pertinents par run de veille

alter table public.veille_runs
  add column if not exists ai_summary      text,
  add column if not exists high_score_count int,
  add column if not exists score_threshold  real default 0.65;
