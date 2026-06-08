-- Remove duplicate veille_items rows (keep oldest per DOI), then add unique index.
DELETE FROM public.veille_items
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY doi ORDER BY created_at ASC) AS rn
    FROM public.veille_items
    WHERE doi IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- Unique partial index: one row per DOI, NULLs excluded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_veille_items_doi_unique
  ON public.veille_items (doi)
  WHERE doi IS NOT NULL;
