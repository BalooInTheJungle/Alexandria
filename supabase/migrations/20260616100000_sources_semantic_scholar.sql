-- Ajout du type 'semantic_scholar' + insertion de la source dédiée

-- 1) Étendre le CHECK sur source_type
ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_source_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_source_type_check
  CHECK (source_type IN ('rss', 'openalex', 'semantic_scholar'));

-- 2) Insérer la source Semantic Scholar si elle n'existe pas déjà
INSERT INTO public.sources (name, publisher, source_type, url)
SELECT 'Semantic Scholar Recommendations', 'Allen Institute for AI', 'semantic_scholar',
       'https://api.semanticscholar.org/recommendations/v1/papers/'
WHERE NOT EXISTS (
  SELECT 1 FROM public.sources WHERE source_type = 'semantic_scholar'
);
