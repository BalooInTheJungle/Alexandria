-- Alexandria: flag is_author_article sur la table documents
-- Marque les articles publiés par le chercheur (data/Articles auteur/)
-- vs les articles du corpus général (data/pdfs2/)

alter table public.documents
  add column if not exists is_author_article boolean not null default false;

comment on column public.documents.is_author_article is
  'True si le document est un article publié par le chercheur (ingéré depuis data/Articles auteur/).';

create index if not exists idx_documents_author_article
  on public.documents (is_author_article)
  where is_author_article = true;
