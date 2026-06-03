-- Track when a researcher has read a veille article
ALTER TABLE public.veille_items ADD COLUMN IF NOT EXISTS read_at timestamptz DEFAULT NULL;

-- Index for filtering unread articles efficiently
CREATE INDEX IF NOT EXISTS idx_veille_items_read_at ON public.veille_items (read_at) WHERE read_at IS NULL;
