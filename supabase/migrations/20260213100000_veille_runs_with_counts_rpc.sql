-- RPC pour lister les runs avec le nombre d'items par run (pour l'onglet Historique).
CREATE OR REPLACE FUNCTION get_veille_runs_with_counts(lim int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz,
  items_count bigint
) AS $$
  SELECT r.id, r.status, r.started_at, r.completed_at, r.error_message, r.created_at,
         COUNT(i.id)::bigint AS items_count
  FROM (SELECT * FROM veille_runs ORDER BY created_at DESC LIMIT lim) r
  LEFT JOIN veille_items i ON i.run_id = r.id
  GROUP BY r.id, r.status, r.started_at, r.completed_at, r.error_message, r.created_at
  ORDER BY r.created_at DESC;
$$ LANGUAGE sql STABLE;
