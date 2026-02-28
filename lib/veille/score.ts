/**
 * Scores : heuristique (placeholder 0) + similarité vectorielle (abstract vs corpus).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/rag/embed";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/score]", new Date().toISOString(), msg, ...args);

export type ScoreResult = { heuristic_score: number; similarity_score: number };

/** Domaines réputés (journal) : bonus léger. */
const REPUTED_DOMAINS = [
  "nature.com",
  "science.org",
  "pubs.rsc.org",
  "pubs.acs.org",
  "wiley.com",
  "springer.com",
  "elsevier.com",
  "frontiersin.org",
  "mdpi.com",
  "plos.org",
];

/**
 * Récupère les termes les plus fréquents du corpus (chunks).
 * Utilise ts_stat sur content_tsv et content_fr_tsv.
 */
export async function getCorpusTopTerms(
  supabase: SupabaseClient,
  limit = 80
): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("get_corpus_top_terms", { lim: limit });
    if (error) {
      LOG("getCorpusTopTerms error", error.message);
      return [];
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const words = rows
      .map((r) => {
        const w = r.word ?? r.w ?? Object.values(r).find((v) => typeof v === "string" && (v as string).length >= 3);
        return typeof w === "string" ? w : null;
      })
      .filter((w): w is string => typeof w === "string" && w.length >= 3);
    LOG("getCorpusTopTerms", { count: words.length, sample: words.slice(0, 10), rawKeys: rows[0] ? Object.keys(rows[0]) : [] });
    return words;
  } catch (err) {
    LOG("getCorpusTopTerms exception", err);
    return [];
  }
}

/**
 * Heuristique : domaine réputé + termes du corpus (les plus fréquents dans les documents).
 * corpusTerms : lexèmes issus de ts_stat (stemmed). On matche par inclusion (ex. "molecul" matche "molecular").
 * Score entre 0 et 1 (cap).
 */
export function computeHeuristicScore(
  url: string,
  title: string | null,
  abstract: string | null | undefined,
  corpusTerms: string[] = []
): number {
  let score = 0;

  try {
    const host = new URL(url).hostname.toLowerCase();
    if (REPUTED_DOMAINS.some((d) => host.includes(d))) {
      score += 0.15;
    }
  } catch {
    // URL invalide
  }

  const text = `${title ?? ""} ${abstract ?? ""}`.toLowerCase();
  if (!text.trim()) return Math.min(1, score);

  let hits = 0;
  for (const term of corpusTerms) {
    if (term.length >= 3 && text.includes(term)) hits++;
  }
  score += Math.min(0.5, hits * 0.06);

  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Similarité : embedding de l'abstract (ou titre si pas d'abstract) vs corpus (match_chunks).
 */
export async function computeSimilarityScore(
  supabase: SupabaseClient,
  text: string
): Promise<number> {
  const input = (text || "").trim().slice(0, 4000);
  if (!input) {
    LOG("computeSimilarityScore empty text");
    return 0;
  }
  LOG("computeSimilarityScore start", { inputLen: input.length });
  try {
    const embedding = await embedQuery(input);
    LOG("computeSimilarityScore embed done", { dim: embedding.length });
    const { data, error } = await supabase.rpc("match_chunks", {
      query_embedding: embedding,
      match_threshold: 0.01,
      match_count: 1,
    });
    if (error) {
      LOG("computeSimilarityScore rpc error", error.message);
      return 0;
    }
    const first = (data as { similarity?: number }[])?.[0];
    const score = first?.similarity ?? 0;
    LOG("computeSimilarityScore", { score });
    return score;
  } catch (err) {
    LOG("computeSimilarityScore error", err);
    return 0;
  }
}

export async function computeScores(
  supabase: SupabaseClient,
  url: string,
  title: string | null,
  abstract: string | null,
  corpusTerms: string[] = []
): Promise<ScoreResult> {
  LOG("computeScores start", { url: url.slice(0, 50), hasTitle: !!title, hasAbstract: !!abstract, corpusTermsCount: corpusTerms.length });
  const heuristic_score = computeHeuristicScore(url, title, abstract, corpusTerms);
  const textForVector = (abstract || title || "").trim();
  const similarity_score = await computeSimilarityScore(supabase, textForVector);
  LOG("computeScores done", { heuristic_score, similarity_score });
  return { heuristic_score, similarity_score };
}
