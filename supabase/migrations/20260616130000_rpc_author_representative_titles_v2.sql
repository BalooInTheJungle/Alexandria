-- Amélioration du filtre de titres : exclut noms de fichiers, DOIs, identifiants

CREATE OR REPLACE FUNCTION get_author_representative_titles(top_n integer DEFAULT 15)
RETURNS TABLE (title text, distance float)
LANGUAGE sql STABLE AS $$
  WITH centroid AS (
    SELECT AVG(c.embedding) AS vec
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.is_author_article = true AND c.embedding IS NOT NULL
  ),
  doc_distances AS (
    SELECT
      d.title,
      AVG(c.embedding <=> (SELECT vec FROM centroid)) AS dist
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.is_author_article = true AND c.embedding IS NOT NULL
    GROUP BY d.title
  )
  SELECT title, dist AS distance
  FROM doc_distances
  WHERE
    length(title) > 25
    AND title ~ '^[A-Z][a-z]'              -- commence par Majuscule + minuscule
    AND title NOT LIKE '%.doc%'             -- pas un nom de fichier Word
    AND title NOT LIKE 'doi:%'              -- pas un DOI brut
    AND title !~ '[A-Z0-9_]{5,}'           -- pas des identifiants type RSC_CC, CHEMPR...
    AND length(title) - length(replace(title, ' ', '')) >= 2  -- au moins 3 mots
  ORDER BY dist ASC
  LIMIT top_n * 2                           -- prend 2x pour compenser les non-trouvés sur SS
$$;
