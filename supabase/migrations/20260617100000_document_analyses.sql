-- Table principale des analyses de documents
CREATE TABLE public.document_analyses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id   uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  title         text,
  doi           text,
  ss_paper_id   text,
  status        text NOT NULL DEFAULT 'pending',
  -- status: pending | processing | completed | error
  summary       jsonb,
  -- { intro, methods, results, discussion, tldr }
  corpus_refs   jsonb,
  -- [{ doc_title, excerpt, page, similarity }]
  cited_refs    jsonb,
  -- [{ raw, doi, in_corpus: bool, ss_metadata?, corpus_similarity? }]
  ss_recs       jsonb,
  -- [{ title, authors, year, doi, abstract, similarity_score }]
  is_integrated boolean NOT NULL DEFAULT false,
  expires_at    timestamptz DEFAULT (now() + interval '7 days'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Index utiles
CREATE INDEX idx_document_analyses_user ON public.document_analyses(user_id);
CREATE INDEX idx_document_analyses_status ON public.document_analyses(status);
CREATE INDEX idx_document_analyses_expires ON public.document_analyses(expires_at) WHERE is_integrated = false;

-- Colonnes sur chunks pour lier à une analyse temporaire
ALTER TABLE public.chunks
  ADD COLUMN IF NOT EXISTS analysis_id uuid REFERENCES public.document_analyses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_temp boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chunks_analysis_id ON public.chunks(analysis_id) WHERE analysis_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_is_temp ON public.chunks(is_temp) WHERE is_temp = true;

-- RLS
ALTER TABLE public.document_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can manage their own analyses"
  ON public.document_analyses
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_document_analyses_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_document_analyses_updated_at
  BEFORE UPDATE ON public.document_analyses
  FOR EACH ROW EXECUTE FUNCTION update_document_analyses_updated_at();
