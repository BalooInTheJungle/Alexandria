/**
 * Détection heuristique d'une page "anti-bot" / Client Challenge.
 * Utilisée pour logger un message clair et suggérer une URL de flux RSS.
 */

/** Fragments (dans le HTML ou le titre) typiques d'une page de défi bot. */
const BOT_CHALLENGE_MARKERS = [
  "client challenge",
  "just a moment",
  "checking your browser",
  "please enable cookies",
  "ddos protection",
  "access denied",
  "blocked",
  "captcha",
  "challenge",
  "perimeterx",
  "cloudflare",
  "ray id",
];

/** Taille en dessous de laquelle le HTML est suspect si on n'a pas d'URLs. */
const SUSPICIOUS_HTML_SIZE = 15_000;

/**
 * Retourne true si le HTML ressemble à une page de défi anti-bot (pas le contenu réel).
 * Utilisé quand une source renvoie 0 URL : on log alors une suggestion (RSS).
 */
export function isLikelyBotChallenge(html: string, _baseUrl: string): boolean {
  if (!html || html.length < 500) return true;
  const lower = html.toLowerCase();
  const titleMatch = lower.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].toLowerCase() : "";
  const snippet = (title + " " + lower.slice(0, 4000)).toLowerCase();

  const hasMarker = BOT_CHALLENGE_MARKERS.some((m) => snippet.includes(m));
  if (hasMarker) return true;

  // HTML très court sans contenu article-like pour un domaine connu
  const hasArticleLike =
    /\/articles\/[a-z0-9-]+|\/content\/articlelanding\/|c-card__title|data-test="article/i.test(html);
  if (html.length < SUSPICIOUS_HTML_SIZE && !hasArticleLike) {
    // Nature / sites JS-heavy envoient souvent un shell minimal
    if (/nature\.com|perimeter|_fs-ch-|challenge/i.test(snippet)) return true;
  }

  return false;
}
