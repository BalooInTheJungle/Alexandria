/**
 * LLM : ne garder que les URLs de pages articles (après guardrails).
 * En cas d'échec (API, timeout, JSON invalide) → l'appelant doit mettre la run en failed.
 */

import { getOpenAIClient, VEILLE_MODEL } from "@/lib/openai";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/filter-urls-llm]", msg, ...args);

const SYSTEM_PROMPT = `Tu filtres une liste d'URLs pour ne garder que celles qui peuvent pointer vers une **page d'article scientifique** (un papier avec titre, auteurs, résumé).

À INCLURE : toute URL qui ressemble à une page d'article (ex. /content/articlelanding/..., /articles/..., /article/..., /paper/..., /full/..., chemins avec identifiant ou DOI). En cas de doute, inclure l'URL.
À EXCLURE uniquement : cookies, politique de confidentialité, login (manuscriptcentral, account, logon), "publish a book", "open access" (page info), "book authors", FAQ, menus généraux, page de recherche (search?q=). Exclure les URLs qui sont clairement des listes (ex. /journals?, /en/journals sans identifiant).

Copie les URLs exactement comme dans la liste. Réponds uniquement par un tableau JSON : ["https://...", ...]`;

/** Chemins qui indiquent clairement une page d'article : on les garde sans demander au LLM. */
const OBVIOUS_ARTICLE_PATH_PATTERNS = [
  /\/content\/articlelanding\//i,
  /\/sw\/content\/articlelanding\//i,
  /\/articles\/[a-z0-9-]+/i,
  /\/article\//i,
  /\/paper\//i,
  /\/full\//i,
];

function isObviousArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const pathAndQuery = u.pathname + u.search;
    return OBVIOUS_ARTICLE_PATH_PATTERNS.some((re) => re.test(pathAndQuery));
  } catch {
    return false;
  }
}

/** Segments de chemin qui indiquent une page non-article (listes, institutionnel, login, page d'accueil). Exclus après le LLM. */
const NON_ARTICLE_PATH_PATTERNS = [
  /^\/(\?.*)?$/i, // racine du site (ex. pubs.rsc.org/, chemistryworld.com/)
  /\/journals\?/i,
  /\/content\/cookies/i,
  /\/book-authors/i,
  /\/open-access/i,
  /manuscriptcentral/i,
  /\/account\/|logon|login/i,
  /\/en\/journals$/i,
  /\/search\?/i,
];

function isLikelyNonArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "") || "/"; // normaliser trailing slash
    const pathAndQuery = path + u.search;
    return NON_ARTICLE_PATH_PATTERNS.some((re) => re.test(pathAndQuery));
  } catch {
    return true;
  }
}

/**
 * Envoie la liste d'URLs au LLM ; retourne uniquement les URLs à garder (pages articles).
 * Préserve le sourceId pour chaque URL retenue.
 * @throws en cas d'erreur (API key, timeout, rate limit, réponse invalide) → run failed
 */
export async function filterUrlsWithLlm(
  sourceUrls: { sourceId: string; url: string }[]
): Promise<{ sourceId: string; url: string }[]> {
  if (sourceUrls.length === 0) {
    LOG("filterUrlsWithLlm", { in: 0, out: 0 });
    return [];
  }

  const obvious = sourceUrls.filter(({ url }) => isObviousArticleUrl(url));
  const toAskLlm = sourceUrls.filter(({ url }) => !isObviousArticleUrl(url));
  if (obvious.length > 0) {
    LOG("filterUrlsWithLlm heuristic keep", { count: obvious.length, sample: obvious.slice(0, 5).map((u) => u.url) });
  }

  if (toAskLlm.length === 0) {
    LOG("filterUrlsWithLlm done", { in: sourceUrls.length, kept: obvious.length, out: obvious.length });
    return obvious;
  }

  const urlList = toAskLlm.map((u) => u.url);
  const userContent = `Liste d'URLs à filtrer (une par ligne) :\n\n${urlList.join("\n")}`;
  LOG("filterUrlsWithLlm request", { urlCount: urlList.length, contentLen: userContent.length });

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: VEILLE_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) {
    LOG("filterUrlsWithLlm error", "OpenAI returned no content");
    throw new Error("OpenAI returned no content for URL filter");
  }
  LOG("filterUrlsWithLlm response", { rawLen: raw.length, usage: response.usage });

  let urlsToKeep: string[];
  try {
    let jsonStr = raw;
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      jsonStr = codeBlock[1].trim();
      LOG("filterUrlsWithLlm parse", "stripped markdown code block");
    }
    urlsToKeep = JSON.parse(jsonStr) as string[];
    if (!Array.isArray(urlsToKeep)) {
      LOG("filterUrlsWithLlm parse", "response is not an array");
      urlsToKeep = [];
    }
    urlsToKeep = urlsToKeep.filter((u) => typeof u === "string" && u.startsWith("http"));
    LOG("filterUrlsWithLlm parse ok", { parsedCount: urlsToKeep.length });
    if (urlsToKeep.length === 0 && toAskLlm.length > 0) {
      LOG("filterUrlsWithLlm LLM returned 0 URLs (raw sample)", { raw: raw.slice(0, 200) });
    }
  } catch (e) {
    LOG("filterUrlsWithLlm parse error", e);
    throw new Error("Invalid JSON response from OpenAI URL filter");
  }

  const keepSet = new Set(urlsToKeep);
  urlsToKeep.forEach((u) => keepSet.add(u.replace(/\?.*/, "")));
  let fromLlm = toAskLlm.filter(
    ({ url }) => keepSet.has(url) || keepSet.has(url.replace(/\?.*/, ""))
  );
  const beforePostFilter = fromLlm.length;
  fromLlm = fromLlm.filter(({ url }) => !isLikelyNonArticleUrl(url));
  if (fromLlm.length < beforePostFilter) {
    LOG("filterUrlsWithLlm postFilter", { removed: beforePostFilter - fromLlm.length, remaining: fromLlm.length });
  }
  const out = [...obvious, ...fromLlm];
  LOG("filterUrlsWithLlm done", { in: sourceUrls.length, heuristic: obvious.length, llmKept: fromLlm.length, out: out.length });
  return out;
}
