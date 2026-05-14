-- Coordonnées UMAP 2D calculées par scripts/compute_umap.py.
-- Nulles jusqu'au premier run du script.

alter table public.chunks
  add column if not exists umap_x float,
  add column if not exists umap_y float;

create index if not exists idx_chunks_umap on public.chunks (umap_x, umap_y)
  where umap_x is not null;

comment on column public.chunks.umap_x is 'Coordonnée UMAP axe X (calculée offline par scripts/compute_umap.py).';
comment on column public.chunks.umap_y is 'Coordonnée UMAP axe Y (calculée offline par scripts/compute_umap.py).';
