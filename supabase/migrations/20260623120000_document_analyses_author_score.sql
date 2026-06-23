alter table public.document_analyses
  add column if not exists author_score float;