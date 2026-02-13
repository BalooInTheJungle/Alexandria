/**
 * Pré-nettoyage du HTML d'une page article (cheerio uniquement, pas de jsdom/Readability).
 * Évite les dépendances ESM incompatibles avec le bundler Next.js.
 * Utilisé avant l'extraction LLM (titre, auteurs, DOI, abstract, date).
 */

import * as cheerio from "cheerio";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/clean-article-html]", msg, ...args);

export type CleanedArticle = {
  title: string | null;
  text: string;
  excerpt: string | null;
  byline: string | null;
  publishedTime: string | null;
};

const MAIN_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".article-content",
  ".article-body",
  ".post-content",
  ".entry-content",
  ".content article",
  ".main-content",
  "#content",
];

function extractText($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, maxChars: number): string {
  root.find("script, style, nav, footer, aside, form, iframe").remove();
  const text = root.text().replace(/\s+/g, " ").trim();
  return text.slice(0, maxChars);
}

/**
 * Isole le contenu article depuis le HTML (titre + texte, sans nav/footer).
 * Utilise cheerio uniquement pour compatibilité Next.js (pas de jsdom/Readability).
 */
export function cleanArticleHtml(html: string, _url?: string): CleanedArticle | null {
  try {
    const $ = cheerio.load(html);
    let title: string | null =
      $("meta[property='og:title']").attr("content")?.trim() ?? $("title").first().text()?.trim() ?? null;
    if (title) title = title.slice(0, 500);

    let mainRoot: cheerio.Cheerio<any> = $([]);
    for (const sel of MAIN_SELECTORS) {
      const el = $(sel).first();
      if (el.length && extractText($, el, 500).length >= 100) {
        mainRoot = el;
        LOG("cleanArticleHtml main selected", { selector: sel });
        break;
      }
    }
    if (mainRoot.length === 0) {
      const body = $("body");
      if (body.length) mainRoot = body;
    }
    const text = mainRoot.length ? extractText($, mainRoot, 30000) : "";
    if (text.length < 50) {
      LOG("cleanArticleHtml", "text too short");
      return null;
    }

    const excerpt =
      $("meta[name='description']").attr("content")?.trim().slice(0, 2000) ??
      $("meta[property='og:description']").attr("content")?.trim().slice(0, 2000) ??
      null;
    const byline =
      $(".byline").first().text()?.trim().slice(0, 500) ??
      $(".author").first().text()?.trim().slice(0, 500) ??
      $("[rel='author']").first().text()?.trim().slice(0, 500) ??
      $("meta[name='author']").attr("content")?.trim().slice(0, 500) ??
      null;
    const publishedTime =
      $("meta[property='article:published_time']").attr("content")?.trim().slice(0, 100) ??
      $(".date").first().text()?.trim().slice(0, 100) ??
      $(".published").first().text()?.trim().slice(0, 100) ??
      $("meta[name='date']").attr("content")?.trim().slice(0, 100) ??
      null;

    LOG("cleanArticleHtml ok", {
      titleLen: title?.length ?? 0,
      textLen: text.length,
      hasExcerpt: !!excerpt,
      hasByline: !!byline,
      hasPublishedTime: !!publishedTime,
    });
    return { title, text, excerpt, byline, publishedTime };
  } catch (err) {
    LOG("cleanArticleHtml error", err);
    return null;
  }
}
