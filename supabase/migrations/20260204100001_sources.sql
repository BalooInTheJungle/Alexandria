-- Alexandria: table sources (URLs à scraper pour la veille)
-- Une seule table unifiée. Si tu as déjà "publications" et "source_url",
-- tu peux les peupler avec:
--   INSERT INTO sources (url, created_at, last_checked_at)
--   SELECT url, created_at, last_checked_at FROM publications;
--   INSERT INTO sources (url, created_at, last_checked_at)
--   SELECT url, created_at, last_checked_at FROM source_url;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  name text,
  created_at timestamptz not null default now(),
  last_checked_at timestamptz
);

create index if not exists idx_sources_url on public.sources (url);

comment on table public.sources is 'URLs des pages sources à scraper (ex-publications + source_url fusionnés).';
