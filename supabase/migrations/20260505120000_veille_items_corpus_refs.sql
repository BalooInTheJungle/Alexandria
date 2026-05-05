-- Add corpus_refs column to veille_items
-- Stores up to 3 best-matching corpus chunks for each scored article (similarity >= 0.75)
-- Structure: [{doc_title, excerpt, page, similarity}]

alter table public.veille_items
  add column if not exists corpus_refs jsonb default null;

comment on column public.veille_items.corpus_refs is
  'Top corpus chunk matches (similarity >= 0.75) used to score this article. JSON array of {doc_title, excerpt, page, similarity}.';
