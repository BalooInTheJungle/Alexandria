alter table public.veille_items
  add column if not exists author_score float;

comment on column public.veille_items.author_score is
  'Similarity score against author articles only (is_author_article=true chunks). Complement to similarity_score which uses the full corpus.';
