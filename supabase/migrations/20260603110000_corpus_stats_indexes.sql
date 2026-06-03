-- Index for get_journal_counts RPC (WHERE status='done' GROUP BY journal)
CREATE INDEX IF NOT EXISTS idx_documents_status_journal
  ON public.documents (status, journal)
  WHERE status = 'done' AND journal IS NOT NULL;

-- Index for get_timeline_by_year RPC (WHERE status='done' GROUP BY year(published_at))
CREATE INDEX IF NOT EXISTS idx_documents_status_published_at
  ON public.documents (status, published_at)
  WHERE status = 'done' AND published_at IS NOT NULL;
