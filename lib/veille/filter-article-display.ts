/**
 * Garde-fou affichage : ne considérer comme "article" (pour la synthèse pipeline) que les items
 * pour lesquels on a réussi à extraire au moins titre, abstract ou DOI, et exclure les titres
 * connus des pages institutionnelles (listes, cookies, "publish a book", etc.).
 */

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/filter-article-display]", msg, ...args);

/** Titres ou motifs (minuscules) qui indiquent une page non-article. À exclure de la synthèse. */
const NON_ARTICLE_TITLE_PATTERNS = [
  "rsc journals home",
  "journals home",
  "rsc publishing home",
  "publishing home",
  "cookies",
  "cookie policy",
  "publish a book",
  "propose your book",
  "open access with the royal",
  "manuscript central",
  "user login",
  "advanced search",
  "databases",
  "the royal society of chemistry",
];

function hasExtractedContent(item: {
  title?: string | null;
  abstract?: string | null;
  doi?: string | null;
}): boolean {
  const title = (item.title ?? "").trim();
  const abstract = (item.abstract ?? "").trim();
  const doi = (item.doi ?? "").trim();
  return title.length > 0 || abstract.length > 0 || doi.length > 0;
}

function isKnownNonArticleTitle(title: string | null): boolean {
  if (!title || !title.trim()) return false;
  const lower = title.trim().toLowerCase();
  return NON_ARTICLE_TITLE_PATTERNS.some((pat) => lower.includes(pat));
}

/**
 * Filtre les items pour ne garder que ceux à afficher comme articles dans la synthèse pipeline.
 * Critères : au moins un de (titre, abstract, DOI) non vide, et titre pas dans la liste des pages institutionnelles.
 */
export function filterItemsForArticleDisplay<T extends { title?: string | null; abstract?: string | null; doi?: string | null }>(
  items: T[]
): T[] {
  const before = items.length;
  const out = items.filter((item) => {
    if (!hasExtractedContent(item)) return false;
    if (isKnownNonArticleTitle(item.title ?? null)) return false;
    return true;
  });
  if (out.length < before) {
    LOG("filterItemsForArticleDisplay", { in: before, out: out.length, removed: before - out.length });
  }
  return out;
}
