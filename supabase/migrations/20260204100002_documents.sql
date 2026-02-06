-- Alexandria: documents (métadonnées PDF)
-- Pas de stockage PDF sur Supabase (storage_path = URL ou chemin externe).
-- Pas de filtre par user : tout le monde a accès.

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text,
  authors text[],
  doi text,
  journal text,
  published_at date,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documents_doi on public.documents (doi) where doi is not null;
create index if not exists idx_documents_status on public.documents (status);

comment on table public.documents is 'Métadonnées des PDF (stockage externe, pas Supabase Storage).';
comment on column public.documents.storage_path is 'URL ou chemin externe du PDF.';
comment on column public.documents.status is 'État ingestion: pending | processing | done | error.';
