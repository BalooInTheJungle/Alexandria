/**
 * Garde-fous : dédup DOI vs DB, limite du nombre d'URLs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/guardrails]", msg, ...args);

const DEFAULT_MAX_URLS_PER_RUN = 30;
const DEFAULT_MAX_URLS_PER_SOURCE = 10;
const MIN_PER_RUN = 1;
const MAX_PER_RUN = 100;
const MIN_PER_SOURCE = 1;
const MAX_PER_SOURCE = 50;

export type VeilleQuotaConfig = {
  maxUrlsPerRun: number;
  maxUrlsPerSource: number;
};

/**
 * Quotas optionnels après filtre LLM. Configurables via env :
 * VEILLE_MAX_URLS_PER_RUN (défaut 30), VEILLE_MAX_URLS_PER_SOURCE (défaut 10).
 */
export function getVeilleQuotaConfig(): VeilleQuotaConfig {
  const perRun = parseInt(process.env.VEILLE_MAX_URLS_PER_RUN ?? "", 10);
  const perSource = parseInt(process.env.VEILLE_MAX_URLS_PER_SOURCE ?? "", 10);
  const maxUrlsPerRun = Number.isNaN(perRun)
    ? DEFAULT_MAX_URLS_PER_RUN
    : Math.max(MIN_PER_RUN, Math.min(MAX_PER_RUN, perRun));
  const maxUrlsPerSource = Number.isNaN(perSource)
    ? DEFAULT_MAX_URLS_PER_SOURCE
    : Math.max(MIN_PER_SOURCE, Math.min(MAX_PER_SOURCE, perSource));
  LOG("getVeilleQuotaConfig", { maxUrlsPerRun, maxUrlsPerSource });
  return { maxUrlsPerRun, maxUrlsPerSource };
}

/** Extensions / chemins typiques de ressources non-articles (à exclure). */
const NON_ARTICLE_PATTERNS = {
  extensions: /\.(png|svg|css|js|ico|webmanifest|woff2?|ttf|eot|map|json)(\?|$)/i,
  pathSegments: /(\/assets\/|\/_fs-ch-|\/cdn\/|\/static\/|rsc-cdn\.org|googletagmanager|google-analytics|doubleclick\.net|facebook\.com|twitter\.com|analytics)/i,
};

/** Chemins typiques de pages d'article (prioritaires pour le quota). */
const ARTICLE_PATH_PATTERNS = /(\/content\/articlelanding\/|\/articles\/|\/en\/article\/|\/content\/[^/]+\/article\/|\/full\/|\/paper\/)/i;

/**
 * Garde uniquement les URLs qui ressemblent à des pages d'article (exclut assets, CDN, analytics).
 */
export function filterArticleCandidateUrls(
  sourceUrls: { sourceId: string; url: string }[]
): { sourceId: string; url: string }[] {
  const before = sourceUrls.length;
  const out = sourceUrls.filter(({ url }) => {
    try {
      const u = new URL(url);
      if (NON_ARTICLE_PATTERNS.extensions.test(u.pathname)) return false;
      if (NON_ARTICLE_PATTERNS.pathSegments.test(u.href)) return false;
      return true;
    } catch {
      return false;
    }
  });
  LOG("filterArticleCandidateUrls", { in: before, out: out.length });
  return out;
}

/**
 * Trie les candidats pour mettre en tête les URLs dont le chemin ressemble à un article
 * (ex. /content/articlelanding/, /articles/), afin que le quota prenne d'abord des vrais articles.
 */
export function sortArticleCandidatesFirst(
  sourceUrls: { sourceId: string; url: string }[]
): { sourceId: string; url: string }[] {
  const copy = [...sourceUrls];
  copy.sort((a, b) => {
    const aMatch = ARTICLE_PATH_PATTERNS.test(a.url);
    const bMatch = ARTICLE_PATH_PATTERNS.test(b.url);
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return 0;
  });
  const articleLike = copy.filter(({ url }) => ARTICLE_PATH_PATTERNS.test(url)).length;
  LOG("sortArticleCandidatesFirst", { total: copy.length, articleLike });
  return copy;
}

/**
 * Récupère les URLs déjà présentes dans veille_items (pour ne pas re-scraper ni envoyer au LLM).
 */
export async function getExistingArticleUrls(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("veille_items")
    .select("url");
  if (error) {
    LOG("getExistingArticleUrls error", error.message);
    return new Set();
  }
  const set = new Set<string>();
  for (const row of data ?? []) {
    if (row.url) set.add(String(row.url).trim());
  }
  LOG("getExistingArticleUrls", { count: set.size });
  return set;
}

/**
 * Retire de la liste les URLs déjà présentes en base (avant envoi au LLM).
 */
export function removeExistingUrls(
  sourceUrls: { sourceId: string; url: string }[],
  existingUrls: Set<string>
): { sourceId: string; url: string }[] {
  const before = sourceUrls.length;
  const out = sourceUrls.filter(({ url }) => !existingUrls.has(url));
  LOG("removeExistingUrls", { in: before, removed: before - out.length, out: out.length });
  return out;
}

/** Récupère les DOI déjà présents (veille_items + documents). */
export async function getExistingDois(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const [items, docs] = await Promise.all([
    supabase.from("veille_items").select("doi").not("doi", "is", null),
    supabase.from("documents").select("doi").not("doi", "is", null),
  ]);
  const set = new Set<string>();
  for (const row of items.data ?? []) {
    if (row.doi) set.add(String(row.doi).trim().toLowerCase());
  }
  for (const row of docs.data ?? []) {
    if (row.doi) set.add(String(row.doi).trim().toLowerCase());
  }
  LOG("getExistingDois", { count: set.size });
  return set;
}

/**
 * Limite le nombre d'URLs par run et par source (après filtre LLM).
 * Utilise getVeilleQuotaConfig() (env ou défauts).
 */
export function applyUrlQuotas(
  sourceUrls: { sourceId: string; url: string }[],
  _existingDois: Set<string>
): { sourceId: string; url: string }[] {
  const { maxUrlsPerRun, maxUrlsPerSource } = getVeilleQuotaConfig();
  const bySource = new Map<string, string[]>();
  for (const { sourceId, url } of sourceUrls) {
    const list = bySource.get(sourceId) ?? [];
    if (list.length < maxUrlsPerSource) list.push(url);
    bySource.set(sourceId, list);
  }
  const out: { sourceId: string; url: string }[] = [];
  for (const [sourceId, urls] of Array.from(bySource.entries())) {
    for (const url of urls) {
      if (out.length >= maxUrlsPerRun) break;
      out.push({ sourceId, url });
    }
  }
  LOG("applyUrlQuotas", {
    maxUrlsPerRun,
    maxUrlsPerSource,
    in: sourceUrls.length,
    out: out.length,
  });
  return out;
}
