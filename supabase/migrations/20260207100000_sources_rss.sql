-- Alexandria: ajout colonnes RSS/ISSN sur la table sources
-- Nouvelle stratégie veille : RSS feeds éditeurs + CrossRef/OpenAlex par ISSN
-- source_type : 'rss' (flux RSS) | 'openalex' (fallback API par ISSN)

alter table public.sources
  add column if not exists publisher    text,
  add column if not exists issn         text,
  add column if not exists rss_url      text,
  add column if not exists source_type  text not null default 'rss'
    check (source_type in ('rss', 'openalex'));

create index if not exists idx_sources_publisher   on public.sources (publisher);
create index if not exists idx_sources_issn        on public.sources (issn);
create index if not exists idx_sources_source_type on public.sources (source_type);

comment on column public.sources.publisher   is 'Éditeur (ACS, RSC, Wiley, Nature, APS, Elsevier, MDPI…)';
comment on column public.sources.issn        is 'ISSN électronique du journal (pour requêtes OpenAlex/CrossRef)';
comment on column public.sources.rss_url     is 'URL du flux RSS à interroger (si source_type = rss)';
comment on column public.sources.source_type is 'rss = flux RSS ; openalex = requête API par ISSN';
