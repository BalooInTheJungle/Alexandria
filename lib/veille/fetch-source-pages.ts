/**
 * Fetch HTML/XML des pages sources (une requête par source).
 * Utilisé pour les pages HTML et les flux RSS/Atom (même fetch, détection du type côté extraction).
 */

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/fetch-source-pages]", msg, ...args);

export type SourcePage = { sourceId: string; url: string; html: string };

export type SourceInput = {
  id: string;
  url: string;
  fetch_strategy?: "auto" | "fetch" | "rss";
};

/**
 * En-têtes type navigateur pour recevoir le même HTML que le navigateur.
 * Sans ça, Nature / RSC peuvent renvoyer un shell minimal (0 liens articles).
 */
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

async function fetchOne(src: SourceInput): Promise<SourcePage | null> {
  try {
    const res = await fetch(src.url, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      LOG("fetch failed", { url: src.url.slice(0, 60), status: res.status });
      return null;
    }
    const html = await res.text();
    LOG("fetch ok", { url: src.url.slice(0, 50), htmlLength: html.length });
    return { sourceId: src.id, url: src.url, html };
  } catch (err) {
    LOG("fetch error", { url: src.url.slice(0, 50), err: String(err) });
    return null;
  }
}

/**
 * Fetch des pages sources en parallèle (une requête par source, async).
 */
export async function fetchSourcePages(
  sources: SourceInput[]
): Promise<SourcePage[]> {
  LOG("fetchSourcePages", { count: sources.length });
  const results = await Promise.all(sources.map(fetchOne));
  const out = results.filter((p): p is SourcePage => p !== null);
  LOG("fetchSourcePages done", { fetched: out.length, total: sources.length });
  return out;
}
