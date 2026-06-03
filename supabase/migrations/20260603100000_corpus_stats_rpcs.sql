-- RPC: top N journals by document count (replaces in-memory grouping in JS)
CREATE OR REPLACE FUNCTION get_journal_counts(top_n integer DEFAULT 20)
RETURNS TABLE(journal text, count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    trim(d.journal) AS journal,
    COUNT(*) AS count
  FROM documents d
  WHERE d.status = 'done'
    AND d.journal IS NOT NULL
    AND trim(d.journal) <> ''
  GROUP BY trim(d.journal)
  ORDER BY count DESC
  LIMIT top_n;
$$;

-- RPC: document count per year (replaces loading 10k rows in JS)
CREATE OR REPLACE FUNCTION get_timeline_by_year(year_min integer DEFAULT 2000, year_max integer DEFAULT 2030)
RETURNS TABLE(year integer, count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    EXTRACT(YEAR FROM published_at)::integer AS year,
    COUNT(*) AS count
  FROM documents
  WHERE status = 'done'
    AND published_at IS NOT NULL
    AND EXTRACT(YEAR FROM published_at) BETWEEN year_min AND year_max
  GROUP BY EXTRACT(YEAR FROM published_at)
  ORDER BY year;
$$;
