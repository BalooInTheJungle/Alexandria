/**
 * Scores : heuristique (placeholder 0) + similarité vectorielle (abstract vs corpus).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/rag/embed";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/score]", msg, ...args);

export type ScoreResult = { heuristic_score: number; similarity_score: number };

/**
 * Heuristique : pour l'instant 0. À définir (mots-clés, regex, position).
 */
export function computeHeuristicScore(_url: string, _title: string | null): number {
  return 0;
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
  abstract: string | null
): Promise<ScoreResult> {
  LOG("computeScores start", { url: url.slice(0, 50), hasTitle: !!title, hasAbstract: !!abstract });
  const heuristic_score = computeHeuristicScore(url, title);
  const textForVector = (abstract || title || "").trim();
  const similarity_score = await computeSimilarityScore(supabase, textForVector);
  LOG("computeScores done", { heuristic_score, similarity_score });
  return { heuristic_score, similarity_score };
}
