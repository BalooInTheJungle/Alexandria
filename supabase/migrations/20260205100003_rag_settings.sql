-- Alexandria: paramètres RAG (admin) — seuil garde-fou, message hors domaine, nombre de tours de contexte
-- Lecture par l’API RAG ; modification depuis le panneau admin.

create table if not exists public.rag_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Valeurs par défaut
insert into public.rag_settings (key, value) values
  ('context_turns', '3'),
  ('similarity_threshold', '0.5'),
  ('guard_message', 'Requête trop éloignée de la recherche fondamentale.'),
  ('match_count', '20'),
  ('match_threshold', '0.3')
on conflict (key) do nothing;

alter table public.rag_settings enable row level security;

-- Lecture pour tous les authentifiés ; écriture réservée (à restreindre si besoin avec un rôle admin)
create policy "rag_settings_select" on public.rag_settings for select to authenticated using (true);
create policy "rag_settings_update" on public.rag_settings for update to authenticated using (true);

comment on table public.rag_settings is 'Paramètres RAG : context_turns, similarity_threshold, guard_message, match_count, match_threshold.';
