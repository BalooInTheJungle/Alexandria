-- Alexandria: paramètres recherche hybride (FTS + RRF)
-- fts_weight, vector_weight, rrf_k, hybrid_top_k

insert into public.rag_settings (key, value) values
  ('fts_weight', '1'),
  ('vector_weight', '1'),
  ('rrf_k', '60'),
  ('hybrid_top_k', '20')
on conflict (key) do nothing;

comment on table public.rag_settings is 'Paramètres RAG : context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k.';
