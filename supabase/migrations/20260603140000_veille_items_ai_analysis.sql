-- Per-item AI analysis from GPT veille summary
ALTER TABLE public.veille_items ADD COLUMN IF NOT EXISTS ai_analysis jsonb DEFAULT NULL;

-- Index for filtering items that have been analyzed
CREATE INDEX IF NOT EXISTS idx_veille_items_ai_analysis ON public.veille_items (id) WHERE ai_analysis IS NOT NULL;
