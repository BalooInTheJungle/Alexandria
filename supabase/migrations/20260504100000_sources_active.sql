-- Alexandria: ajout colonne active sur la table sources
-- Permet d'activer/désactiver une source de veille depuis l'UI sans la supprimer

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_sources_active ON public.sources (active);

-- Activer toutes les sources existantes (celles avant cette migration)
UPDATE public.sources SET active = true WHERE active IS NULL;

COMMENT ON COLUMN public.sources.active IS 'false = source exclue du pipeline veille (désactivée par l''utilisateur)';
