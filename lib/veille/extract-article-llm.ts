/**
 * Extraction métadonnées article depuis le HTML.
 * Pré-nettoyage HTML (cheerio) puis extraction par LLM (titre, auteurs, DOI, abstract, date).
 */

import { getOpenAIClient, VEILLE_MODEL } from "@/lib/openai";
import type { CleanedArticle } from "./clean-article-html";
import { cleanArticleHtml } from "./clean-article-html";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/extract-article]", msg, ...args);

export type ExtractedArticle = {
  title: string | null;
  authors: string[];
  doi: string | null;
  abstract: string | null;
  published_at: string | null;
};

/** Texte nettoyé (exposé pour debug / futur). */
export type ExtractedArticleWithText = ExtractedArticle & { cleanedText?: string | null };

const TITLE_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_DESCRIPTION = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;
const META_DC_DATE = /<meta[^>]+name=["'](?:DC\.date|date)["'][^>]+content=["']([^"']*)["']/i;

/** Taille max du texte envoyé au LLM (éviter dépassement contexte). */
const MAX_TEXT_FOR_LLM = 12000;

const EXTRACT_SYSTEM_PROMPT = `Tu es un assistant qui extrait les métadonnées d'un article scientifique à partir du texte fourni.
Extrais et renvoie uniquement un objet JSON avec exactement ces champs (utilise null si absent ou inconnu) :
- "title" : string (titre de l'article)
- "authors" : tableau de strings (noms des auteurs)
- "doi" : string (DOI de l'article, ex. 10.1234/xxx)
- "abstract" : string (résumé / abstract)
- "published_at" : string (date de publication, format ISO ou YYYY-MM-DD si possible)

Réponds uniquement par cet objet JSON, sans aucun autre texte ni commentaire.`;

function authorsFromByline(byline: string | null): string[] {
  if (!byline?.trim()) return [];
  return byline
    .split(/[,;]|\s+and\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

type LlmExtract = {
  title?: string | null;
  authors?: string[] | null;
  doi?: string | null;
  abstract?: string | null;
  published_at?: string | null;
};

/**
 * Appelle le LLM pour extraire titre, auteurs, DOI, abstract, date depuis le texte nettoyé.
 * @returns objet partiel ou null en cas d'erreur (fallback côté appelant)
 */
async function extractArticleWithLlm(
  cleaned: CleanedArticle,
  url: string
): Promise<ExtractedArticle | null> {
  LOG("extractArticleWithLlm start", { url: url.slice(0, 50), textLen: cleaned.text.length });
  const textToSend = cleaned.text.slice(0, MAX_TEXT_FOR_LLM);
  if (textToSend.length < 100) {
    LOG("extractArticleWithLlm skip", "text too short");
    return null;
  }

  let client;
  try {
    client = getOpenAIClient();
  } catch (e) {
    LOG("extractArticleWithLlm client error", e);
    return null;
  }

  const userContent = `URL de la page : ${url}\n\nTitre brut (si connu) : ${cleaned.title ?? "—"}\n\nTexte de l'article :\n\n${textToSend}`;
  LOG("extractArticleWithLlm request", { contentLen: userContent.length, model: VEILLE_MODEL });

  try {
    const response = await client.chat.completions.create({
      model: VEILLE_MODEL,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    });

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) {
      LOG("extractArticleWithLlm empty response");
      return null;
    }
    LOG("extractArticleWithLlm response", { rawLen: raw.length, usage: response.usage });

    let jsonStr = raw;
    const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      jsonStr = codeBlock[1].trim();
      LOG("extractArticleWithLlm parse", "stripped markdown code block");
    }

    const parsed = JSON.parse(jsonStr) as LlmExtract;
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 500)
        : null;
    const authors = Array.isArray(parsed.authors)
      ? parsed.authors
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 30)
      : [];
    const doi =
      typeof parsed.doi === "string" && parsed.doi.trim()
        ? parsed.doi.trim().slice(0, 200)
        : null;
    const abstract =
      typeof parsed.abstract === "string" && parsed.abstract.trim()
        ? parsed.abstract.trim().slice(0, 5000)
        : null;
    const published_at =
      typeof parsed.published_at === "string" && parsed.published_at.trim()
        ? parsed.published_at.trim().slice(0, 100)
        : null;

    LOG("extractArticleWithLlm ok", {
      hasTitle: !!title,
      authorsCount: authors.length,
      hasDoi: !!doi,
      hasAbstract: !!abstract,
      hasPublishedAt: !!published_at,
    });
    return { title, authors, doi, abstract, published_at };
  } catch (err) {
    LOG("extractArticleWithLlm error", err);
    return null;
  }
}

export async function extractArticleFromUrl(
  url: string
): Promise<ExtractedArticle & { last_error?: string }> {
  LOG("extractArticleFromUrl", { url: url.slice(0, 60) });
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AlexandriaVeille/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const err = `HTTP ${res.status}`;
      LOG("extractArticleFromUrl fetch failed", { url: url.slice(0, 50), status: res.status });
      return { title: null, authors: [], doi: null, abstract: null, published_at: null, last_error: err };
    }
    const html = await res.text();
    LOG("extractArticleFromUrl fetch ok", { htmlLen: html.length });

    const cleaned = cleanArticleHtml(html, url);

    let title: string | null = null;
    let abstract: string | null = null;
    let published_at: string | null = null;
    let authors: string[] = [];
    let doi: string | null = null;

    if (cleaned) {
      const llmResult = await extractArticleWithLlm(cleaned, url);
      if (llmResult) {
        title = llmResult.title ?? null;
        abstract = llmResult.abstract ?? null;
        published_at = llmResult.published_at ?? null;
        authors = llmResult.authors?.length ? llmResult.authors : [];
        doi = llmResult.doi ?? null;
        LOG("extractArticleFromUrl using LLM result");
      }
      if (!title && cleaned.title) title = cleaned.title.slice(0, 500);
      if (!abstract && cleaned.excerpt) abstract = cleaned.excerpt;
      if (!published_at && cleaned.publishedTime) published_at = cleaned.publishedTime;
      if (authors.length === 0) authors = authorsFromByline(cleaned.byline);
    }

    if (!title) {
      const mTitle = TITLE_REGEX.exec(html);
      if (mTitle) {
        title = mTitle[1].replace(/\s+/g, " ").trim().slice(0, 500);
        LOG("extractArticleFromUrl fallback", "title from <title>");
      }
    }
    if (!abstract) {
      const mDesc = META_DESCRIPTION.exec(html);
      if (mDesc) {
        abstract = mDesc[1].trim().slice(0, 2000);
        LOG("extractArticleFromUrl fallback", "abstract from meta description");
      }
    }
    if (!published_at) {
      const mDate = META_DC_DATE.exec(html);
      if (mDate) {
        published_at = mDate[1].trim().slice(0, 50);
        LOG("extractArticleFromUrl fallback", "published_at from meta");
      }
    }

    LOG("extractArticleFromUrl ok", {
      title: title?.slice(0, 40),
      authorsCount: authors.length,
      hasDoi: !!doi,
      hasAbstract: !!abstract,
      hasPublishedAt: !!published_at,
    });
    return { title, authors, doi, abstract, published_at };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    LOG("extractArticleFromUrl error", { url: url.slice(0, 50), err: msg });
    return {
      title: null,
      authors: [],
      doi: null,
      abstract: null,
      published_at: null,
      last_error: msg,
    };
  }
}
