-- Stratégie de récupération par source : fetch (défaut), rss, ou browser (Playwright)
alter table public.sources
  add column if not exists fetch_strategy text default 'auto';

comment on column public.sources.fetch_strategy is 'auto | fetch | rss | browser. browser = headless Playwright for anti-bot.';
