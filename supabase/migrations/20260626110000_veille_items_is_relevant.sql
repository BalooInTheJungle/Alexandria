-- Feedback chercheur : pertinent / pas pertinent sur les articles de veille.
-- NULL = non évalué, true = pertinent, false = pas pertinent.
ALTER TABLE public.veille_items
  ADD COLUMN IF NOT EXISTS is_relevant boolean DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_veille_items_is_relevant
  ON public.veille_items(is_relevant)
  WHERE is_relevant IS NOT NULL;
