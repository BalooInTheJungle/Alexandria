-- Alexandria: RLS — tous les users authentifiés ont les mêmes droits (lecture/écriture).

alter table public.sources enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.veille_runs enable row level security;
alter table public.veille_items enable row level security;

-- Politique: tout utilisateur authentifié peut tout faire (pas de rôle spécifique).
create policy "sources_select" on public.sources for select to authenticated using (true);
create policy "sources_insert" on public.sources for insert to authenticated with check (true);
create policy "sources_update" on public.sources for update to authenticated using (true);

create policy "documents_select" on public.documents for select to authenticated using (true);
create policy "documents_insert" on public.documents for insert to authenticated with check (true);
create policy "documents_update" on public.documents for update to authenticated using (true);

create policy "chunks_select" on public.chunks for select to authenticated using (true);
create policy "chunks_insert" on public.chunks for insert to authenticated with check (true);
create policy "chunks_update" on public.chunks for update to authenticated using (true);
create policy "chunks_delete" on public.chunks for delete to authenticated using (true);

create policy "veille_runs_select" on public.veille_runs for select to authenticated using (true);
create policy "veille_runs_insert" on public.veille_runs for insert to authenticated with check (true);
create policy "veille_runs_update" on public.veille_runs for update to authenticated using (true);

create policy "veille_items_select" on public.veille_items for select to authenticated using (true);
create policy "veille_items_insert" on public.veille_items for insert to authenticated with check (true);
create policy "veille_items_update" on public.veille_items for update to authenticated using (true);
