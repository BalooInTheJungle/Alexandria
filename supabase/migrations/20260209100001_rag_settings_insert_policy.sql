-- Permettre l'insertion de nouvelles clés rag_settings par les utilisateurs authentifiés
-- (nécessaire pour upsert quand une clé n'existe pas encore, ex. use_similarity_guard)

create policy "rag_settings_insert" on public.rag_settings
  for insert to authenticated with check (true);
