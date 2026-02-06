/**
 * Détection heuristique de la langue de la requête (FR vs EN).
 * Utilisé pour choisir le pipeline RAG (match_chunks_fr + search_chunks_fts_fr vs EN).
 */

export type DetectedLang = "fr" | "en";

// Caractères accentués courants en français
const FR_ACCENTS = /[àâäéèêëïîôùûüçœæ]/i;
// Mots courts très fréquents en français (éviter faux positifs avec mots anglais)
const FR_WORDS =
  /\b(le|la|les|des|une?|et|est|sont|dans|pour|que|qui|pas|sur|avec|aux|du|de|en|au|ce|cette|ces|mes|tes|ses|nos|vos|mon|ton|son|ma|ta|sa|notre|votre|leur)\b/i;
// Mots courts très fréquents en anglais (pour contre-balancer)
const EN_WORDS =
  /\b(the|and|is|are|in|to|of|for|on|with|as|at|be|by|this|that|it|its|have|has|was|were)\b/i;

/**
 * Détecte si la requête est plutôt en français ou en anglais.
 * Heuristique : accents français, mots-outils FR vs EN. Défaut : 'en'.
 */
export function detectQueryLanguage(query: string): DetectedLang {
  const t = query.trim();
  if (!t) return "en";

  let frScore = 0;
  let enScore = 0;

  if (FR_ACCENTS.test(t)) frScore += 2;
  const frWordMatches = t.match(FR_WORDS);
  if (frWordMatches) frScore += frWordMatches.length;
  const enWordMatches = t.match(EN_WORDS);
  if (enWordMatches) enScore += enWordMatches.length;

  return frScore >= enScore ? "fr" : "en";
}
