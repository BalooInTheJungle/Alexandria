-- Pipeline veille: colonne heuristic_score + politique DELETE sur sources

-- 1) Score heuristique sur veille_items (définition à préciser côté app)
alter table public.veille_items
  add column if not exists heuristic_score real;

comment on column public.veille_items.heuristic_score is 'Score heuristique (ex. mots-clés, regex). À combiner avec similarity_score pour le score final.';

-- 2) RLS: permettre la suppression des sources (CRUD complet)
create policy "sources_delete" on public.sources for delete to authenticated using (true);
