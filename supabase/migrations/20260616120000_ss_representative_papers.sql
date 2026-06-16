-- Table de cache des titres représentatifs pour Semantic Scholar recommendations
-- Recalculée manuellement après chaque ingestion --author (compute-ss-representatives.ts)

CREATE TABLE IF NOT EXISTS public.ss_representative_papers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  distance    float NOT NULL,
  ss_paper_id text,             -- paperId SS résolu (null si non trouvé)
  computed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ss_representative_papers IS
  'Cache des articles auteur les plus représentatifs du corpus (centroïde embeddings). Recalculer avec compute-ss-representatives.ts après chaque ingestion --author.';
