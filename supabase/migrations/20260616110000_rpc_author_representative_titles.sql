-- RPC : retourne les N titres d'articles auteur les plus proches du centroïde
-- Usage : SELECT * FROM get_author_representative_titles(15)

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
  WHERE length(title) > 20 AND title ~ '^[A-Za-z]'
  ORDER BY dist ASC
  LIMIT top_n;
$$;
