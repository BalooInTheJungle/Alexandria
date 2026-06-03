-- Index for get_veille_runs_with_counts RPC (LEFT JOIN veille_items ON run_id)
CREATE INDEX IF NOT EXISTS idx_veille_items_run_id ON public.veille_items (run_id);
