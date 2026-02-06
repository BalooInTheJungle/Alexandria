-- Alexandria: log d'ingestion par document (ce qui a été récupéré ou non)
alter table public.documents
  add column if not exists ingestion_log jsonb;

comment on column public.documents.ingestion_log is 'Résumé de l’ingestion: titre/DOI/auteurs récupérés, nb chunks, pages OCR, etc.';
