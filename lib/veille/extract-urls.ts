/**
 * Extraction d'URLs candidates depuis le HTML (parse DOM avec cheerio, balises <a href>)
 * ou depuis un flux RSS/Atom (balises item/link, entry/link).
 * Si aucune URL n'est trouvée (page possiblement rendue en JS), fallback : scan du HTML brut.
 */

import * as cheerio from "cheerio";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/extract-urls]", msg, ...args);

/** Détecte si le contenu est un flux RSS 2.0, Atom ou RSS 1.0 (RDF). */
export function isRssOrAtom(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<rss") ||
    trimmed.startsWith("<feed") ||
    trimmed.startsWith("<rdf:RDF") ||
    trimmed.includes("<rdf:RDF")
  );
}

/**
 * Extrait les URLs des items d'un flux RSS 2.0, RSS 1.0 (RDF) ou Atom.
 * RSS 2.0: <item><link>...</link></item> ou <item><guid>...</guid></item>
 * RSS 1.0 (RDF): <item rdf:about="URL"> avec <link>...</link> ou rdf:about comme URL
 * Atom: <entry><link href="..."/> ou <id>...</id>
 */
export function extractUrlsFromRss(content: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const urls: string[] = [];

  const $ = cheerio.load(content, { xmlMode: true, decodeEntities: true });

  $("item").each((_, el) => {
    const $el = $(el);
    let link =
      $el.find("link").first().text().trim() ||
      $el.find("guid").first().text().trim();
    // RSS 1.0 (RDF): <item rdf:about="https://..."> peut être l'URL de l'article
    if (!link && $el.attr("rdf:about")) link = $el.attr("rdf:about")?.trim() ?? "";
    if (link && link.startsWith("http")) {
      try {
        const absolute = new URL(link, base).href;
        if (!seen.has(absolute)) {
          seen.add(absolute);
          urls.push(absolute);
        }
      } catch {
        // skip
      }
    }
  });

  $("entry").each((_, el) => {
    const link =
      $(el).find('link[type="text/html"]').attr("href") ||
      $(el).find("link").attr("href") ||
      $(el).find("id").first().text().trim();
    if (link && link.startsWith("http")) {
      try {
        const absolute = new URL(link, base).href;
        if (!seen.has(absolute)) {
          seen.add(absolute);
          urls.push(absolute);
        }
      } catch {
        // skip
      }
    }
  });

  LOG("extractUrlsFromRss", { baseUrl: baseUrl.slice(0, 50), count: urls.length });
  return urls;
}

/** Regex pour trouver des URLs http(s) dans du texte (utilisé en fallback). */
const URL_IN_TEXT =
  /https?:\/\/[^\s"']+/g;

/** Retourne des URLs absolues (base = page source). */
export function extractUrlsFromHtml(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const seen = new Set<string>();
  const urls: string[] = [];

  const $ = cheerio.load(html, { decodeEntities: true });
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const raw = href.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;
    try {
      const absolute = new URL(raw, base).href;
      if (seen.has(absolute)) return;
      seen.add(absolute);
      urls.push(absolute);
    } catch {
      // URL invalide, skip
    }
  });

  if (urls.length === 0) {
    const fromRaw = extractUrlsFromRawHtml(html, base);
    const fromRelative = extractRelativeArticleUrls(html, base);
    for (const u of [...fromRaw, ...fromRelative]) {
      if (seen.has(u)) continue;
      try {
        const parsed = new URL(u);
        if (parsed.origin !== origin) continue;
        seen.add(u);
        urls.push(u);
      } catch {
        // skip
      }
    }
    if (urls.length > 0) {
      LOG("extractUrlsFromHtml fallback (HTML/script)", { baseUrl: baseUrl.slice(0, 50), count: urls.length });
    }
  }

  if (urls.length === 0 || urls.length < 5) {
    const hasNatureCards = /c-card__title|data-test="article-description"/i.test(html);
    const hasArticlePaths = /\/articles\/[a-z0-9-]+|\/content\/articlelanding\//i.test(html);
    const hint = !hasNatureCards && !hasArticlePaths ? "HTML may be a JS shell (server sent minimal page)" : undefined;
    LOG("extractUrlsFromHtml HTML diagnostic", {
      baseUrl: baseUrl.slice(0, 50),
      htmlLen: html.length,
      hasNatureCards,
      hasArticlePaths,
      hint,
      ...(urls.length === 0 && hint
        ? { htmlSnippet: html.slice(0, 700).replace(/\s+/g, " ").trim() }
        : {}),
    });
  }

  LOG("extractUrlsFromHtml", { baseUrl: baseUrl.slice(0, 50), count: urls.length });
  return urls;
}

/**
 * Extrait des chemins relatifs type article dans le HTML/JSON (ex. dans <script>).
 * Ex. "/articles/s41556-025-01830-7" ou "href\":\"/articles/xxx\".
 */
function extractRelativeArticleUrls(html: string, base: URL): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const patterns = [
    /["'](\/articles\/[a-zA-Z0-9-]+)["']/g,
    /["'](\/content\/articlelanding\/[^"']+)["']/g,
    /href\s*=\s*["']([^"']*\/articles\/[a-zA-Z0-9-]+)["']/gi,
    /href\s*=\s*["']([^"']*\/content\/articlelanding\/[^"']+)["']/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const path = m[1].replace(/[)"'>\].]+$/, "").trim();
      if (!path || seen.has(path)) continue;
      try {
        const absolute = new URL(path, base).href;
        seen.add(path);
        out.push(absolute);
      } catch {
        // skip
      }
    }
  }
  return out;
}

/**
 * Extrait des URLs depuis le HTML brut (scripts, JSON embarqué).
 * Ne garde que les URLs du même domaine ayant l'air de pages articles (/articles/, /article/, /content/articlelanding/, etc.).
 */
function extractUrlsFromRawHtml(html: string, base: URL): string[] {
  const origin = base.origin;
  const out: string[] = [];
  const seen = new Set<string>();
  const matches = html.matchAll(URL_IN_TEXT);
  const articleLike = /\.(com|org)\/(articles?|content\/article|content\/articlelanding|articlelanding)[\/\?]/i;
  for (const m of matches) {
    const raw = m[0].replace(/[)"'>\],]+$/, "").trim();
    if (seen.has(raw)) continue;
    try {
      const u = new URL(raw);
      if (u.origin !== origin) continue;
      if (!articleLike.test(u.href)) continue;
      seen.add(raw);
      out.push(raw);
    } catch {
      // skip
    }
  }
  return out;
}
