/**
 * Recherche RAG : hybride (FTS + vector) avec fusion RRF.
 * Paramètres via rag_settings (fts_weight, vector_weight, rrf_k, hybrid_top_k).
 */

import { createClient } from "@/lib/supabase/server";
import { embedQuery } from "./embed";
import { getRagSettings, type RagSettings } from "./settings";

export type MatchedChunk = {
  id: string;
  document_id: string;
  content: string;
  position: number;
  page: number | null;
  section_title: string | null;
  similarity: number;
  doc_title: string | null;
  doc_doi: string | null;
  doc_storage_path: string;
};

type FtsChunkRow = {
  id: string;
  document_id: string;
  content: string;
  position: number;
  page: number | null;
  section_title: string | null;
  rank: number;
  doc_title: string | null;
  doc_doi: string | null;
  doc_storage_path: string;
};

const DEFAULT_MATCH_THRESHOLD = 0.01;
const DEFAULT_MATCH_COUNT = 20;

const LOG = (msg: string, ...args: unknown[]) => console.log("[RAG/search]", msg, ...args);

/**
 * Fusion RRF (Reciprocal Rank Fusion) des listes vector et FTS.
 * score(id) = vector_weight / (k + rank_v) + fts_weight / (k + rank_fts)
 * Retourne les chunks (données du vector) ordonnés par score RRF décroissant, limité à topK.
 */
function rrfMerge(
  vectorChunks: MatchedChunk[],
  ftsChunks: FtsChunkRow[],
  params: { vector_weight: number; fts_weight: number; rrf_k: number; hybrid_top_k: number }
): MatchedChunk[] {
  const { vector_weight, fts_weight, rrf_k, hybrid_top_k } = params;
  const k = Math.max(1, rrf_k);
  const byId = new Map<string, MatchedChunk>();
  const scores = new Map<string, number>();

  vectorChunks.forEach((c, i) => {
    byId.set(c.id, c);
    const rankV = i + 1;
    scores.set(c.id, (scores.get(c.id) ?? 0) + vector_weight / (k + rankV));
  });

  ftsChunks.forEach((c, i) => {
    const rankF = i + 1;
    const current = scores.get(c.id) ?? 0;
    scores.set(c.id, current + fts_weight / (k + rankF));
    if (!byId.has(c.id)) {
      byId.set(c.id, {
        id: c.id,
        document_id: c.document_id,
        content: c.content,
        position: c.position,
        page: c.page,
        section_title: c.section_title,
        similarity: 0,
        doc_title: c.doc_title,
        doc_doi: c.doc_doi,
        doc_storage_path: c.doc_storage_path,
      });
    }
  });

  const sorted = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, hybrid_top_k)
    .map(([id]) => byId.get(id)!)
    .filter(Boolean);

  return sorted;
}

export type SearchChunksResult = {
  chunks: MatchedChunk[];
  /** Meilleure similarité vectorielle (avant RRF), pour le garde-fou. */
  bestVectorSimilarity: number;
};

/**
 * Recherche hybride : vector (match_chunks) + FTS (search_chunks_fts) puis fusion RRF.
 * Si fts_weight = 0 ou requête vide pour FTS, retourne uniquement les résultats vectoriels (top hybrid_top_k).
 * Le garde-fou doit utiliser bestVectorSimilarity (premier résultat vectoriel, avant fusion).
 */
export async function searchChunks(
  query: string,
  options?: {
    matchThreshold?: number;
    matchCount?: number;
    settings?: RagSettings;
  }
): Promise<SearchChunksResult> {
  const threshold = options?.matchThreshold ?? DEFAULT_MATCH_THRESHOLD;
  const matchCount = options?.matchCount ?? DEFAULT_MATCH_COUNT;
  const settings = options?.settings ?? (await getRagSettings());

  const hybridTopK = Math.max(1, settings.hybrid_top_k);
  const useFts = settings.fts_weight > 0 && query.trim().length > 0;

  LOG("searchChunks", {
    queryLength: query.length,
    threshold,
    matchCount,
    hybridTopK,
    useFts,
    fts_weight: settings.fts_weight,
    vector_weight: settings.vector_weight,
    rrf_k: settings.rrf_k,
  });

  const embedding = await embedQuery(query);
  LOG("Embedding done", { dim: embedding.length });

  const supabase = await createClient();

  const { data: vectorData, error: vectorError } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: Math.max(matchCount, useFts ? hybridTopK * 2 : hybridTopK),
  });

  if (vectorError) {
    console.error("[RAG/search] match_chunks error", vectorError);
    throw new Error(`RAG search failed: ${vectorError.message}`);
  }

  const vectorChunks = (vectorData ?? []) as MatchedChunk[];
  const bestVectorSimilarity = vectorChunks[0]?.similarity ?? 0;
  LOG("match_chunks result", { count: vectorChunks.length, bestVectorSimilarity });

  if (!useFts || vectorChunks.length === 0) {
    return {
      chunks: vectorChunks.slice(0, hybridTopK),
      bestVectorSimilarity,
    };
  }

  const { data: ftsData, error: ftsError } = await supabase.rpc("search_chunks_fts", {
    query_text: query.trim(),
    match_limit: hybridTopK * 2,
  });

  if (ftsError) {
    LOG("search_chunks_fts error (fallback vector only)", ftsError.message);
    return {
      chunks: vectorChunks.slice(0, hybridTopK),
      bestVectorSimilarity,
    };
  }

  const ftsChunks = (ftsData ?? []) as FtsChunkRow[];
  LOG("search_chunks_fts result", { count: ftsChunks.length });

  const merged = rrfMerge(vectorChunks, ftsChunks, {
    vector_weight: settings.vector_weight,
    fts_weight: settings.fts_weight,
    rrf_k: settings.rrf_k,
    hybrid_top_k: hybridTopK,
  });

  LOG("RRF merged", { count: merged.length });
  return { chunks: merged, bestVectorSimilarity };
}
