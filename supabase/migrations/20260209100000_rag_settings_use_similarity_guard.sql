-- Alexandria: paramètre pour activer/désactiver le garde-fou par similarité
-- Si false : la recherche n'est jamais bloquée par le seuil (on appelle toujours le LLM).

insert into public.rag_settings (key, value) values
  ('use_similarity_guard', 'true')
on conflict (key) do nothing;

comment on table public.rag_settings is 'Paramètres RAG : use_similarity_guard, context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k.';
