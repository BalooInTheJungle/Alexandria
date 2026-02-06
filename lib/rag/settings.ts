/**
 * Lecture des paramètres RAG depuis la table rag_settings (admin).
 * Utilisé par l’API chat pour garde-fou, match_count, contexte, etc.
 */

import { createClient } from "@/lib/supabase/server";

export type RagSettings = {
  context_turns: number;
  similarity_threshold: number;
  guard_message: string;
  match_count: number;
  match_threshold: number;
  fts_weight: number;
  vector_weight: number;
  rrf_k: number;
  hybrid_top_k: number;
};

const DEFAULT_SETTINGS: RagSettings = {
  context_turns: 3,
  similarity_threshold: 0.5,
  guard_message: "Requête trop éloignée de la recherche fondamentale.",
  match_count: 20,
  match_threshold: 0.3,
  fts_weight: 1,
  vector_weight: 1,
  rrf_k: 60,
  hybrid_top_k: 20,
};

function parseFloatSafe(value: string | null, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntSafe(value: string | null, fallback: number): number {
  if (value == null || value === "") return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const LOG = (msg: string, ...args: unknown[]) => console.log("[RAG/settings]", msg, ...args);

/**
 * Charge les paramètres RAG depuis la base (table rag_settings).
 * Si une clé manque ou est invalide, utilise les valeurs par défaut.
 */
export async function getRagSettings(): Promise<RagSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rag_settings")
    .select("key, value");

  if (error) {
    LOG("DB error, using defaults", error.message);
    return DEFAULT_SETTINGS;
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.key, row.value ?? "");
  }
  LOG("Loaded", { keys: Array.from(map.keys()) });

  return {
    context_turns: parseIntSafe(map.get("context_turns") ?? null, DEFAULT_SETTINGS.context_turns),
    similarity_threshold: parseFloatSafe(map.get("similarity_threshold") ?? null, DEFAULT_SETTINGS.similarity_threshold),
    guard_message: (map.get("guard_message") ?? "").trim() || DEFAULT_SETTINGS.guard_message,
    match_count: parseIntSafe(map.get("match_count") ?? null, DEFAULT_SETTINGS.match_count),
    match_threshold: parseFloatSafe(map.get("match_threshold") ?? null, DEFAULT_SETTINGS.match_threshold),
    fts_weight: parseFloatSafe(map.get("fts_weight") ?? null, DEFAULT_SETTINGS.fts_weight),
    vector_weight: parseFloatSafe(map.get("vector_weight") ?? null, DEFAULT_SETTINGS.vector_weight),
    rrf_k: parseIntSafe(map.get("rrf_k") ?? null, DEFAULT_SETTINGS.rrf_k),
    hybrid_top_k: parseIntSafe(map.get("hybrid_top_k") ?? null, DEFAULT_SETTINGS.hybrid_top_k),
  };
}
