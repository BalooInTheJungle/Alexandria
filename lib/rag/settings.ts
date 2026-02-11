/**
 * Lecture des paramètres RAG depuis la table rag_settings (admin).
 * Utilisé par l'API chat pour garde-fou, match_count, contexte, etc.
 */

import { createClient } from "@/lib/supabase/server";

export type RagSettings = {
  use_similarity_guard: boolean;
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
  use_similarity_guard: true,
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

function parseBool(value: string | null, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  const v = value.toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes";
}

/** Bornes de validation pour PATCH admin. Valeur hors bornes → 400 sans modifier la base. */
export const RAG_SETTINGS_BOUNDS: Record<
  keyof RagSettings,
  { min?: number; max?: number; maxLength?: number; type: "integer" | "float" | "string" | "boolean" }
> = {
  use_similarity_guard: { type: "boolean" },
  context_turns: { min: 1, max: 10, type: "integer" },
  similarity_threshold: { min: 0.1, max: 0.9, type: "float" },
  guard_message: { maxLength: 1000, type: "string" },
  match_count: { min: 5, max: 100, type: "integer" },
  match_threshold: { min: 0, max: 1, type: "float" },
  fts_weight: { min: 0, max: 10, type: "float" },
  vector_weight: { min: 0, max: 10, type: "float" },
  rrf_k: { min: 1, max: 200, type: "integer" },
  hybrid_top_k: { min: 5, max: 100, type: "integer" },
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
    use_similarity_guard: parseBool(map.get("use_similarity_guard") ?? null, DEFAULT_SETTINGS.use_similarity_guard),
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

/** Bornes de validation pour chaque clé (min, max). */
const BOUNDS: Record<
  keyof RagSettings,
  { min: number; max: number } | null
> = {
  use_similarity_guard: null,
  context_turns: { min: 1, max: 10 },
  similarity_threshold: { min: 0.1, max: 0.9 },
  guard_message: null,
  match_count: { min: 5, max: 100 },
  match_threshold: { min: 0, max: 1 },
  fts_weight: { min: 0, max: 10 },
  vector_weight: { min: 0, max: 10 },
  rrf_k: { min: 1, max: 200 },
  hybrid_top_k: { min: 5, max: 100 },
};

/**
 * Valide un objet partiel de paramètres RAG. Retourne une erreur texte si invalide.
 */
export function validateRagSettings(
  partial: Partial<RagSettings>
): { ok: true } | { ok: false; error: string } {
  for (const key of Object.keys(partial) as (keyof RagSettings)[]) {
    const value = partial[key];
    if (value === undefined) continue;
    const b = BOUNDS[key];
    if (key === "guard_message") {
      if (typeof value !== "string") {
        return { ok: false, error: `guard_message doit être une chaîne` };
      }
      continue;
    }
    if (key === "use_similarity_guard") {
      if (typeof value !== "boolean") {
        return { ok: false, error: `use_similarity_guard doit être true ou false` };
      }
      continue;
    }
    if (b) {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `${key} doit être un nombre` };
      }
      if (n < b.min || n > b.max) {
        return {
          ok: false,
          error: `${key} doit être entre ${b.min} et ${b.max} (reçu: ${n})`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Met à jour les paramètres RAG en base. Valide les bornes avant écriture.
 * En cas d'erreur de validation, ne modifie rien et retourne { ok: false, error }.
 */
export async function updateRagSettings(
  partial: Partial<RagSettings>
): Promise<RagSettings | { ok: false; error: string }> {
  const validation = validateRagSettings(partial);
  if (!validation.ok) return validation;

  const supabase = await createClient();
  const keys: (keyof RagSettings)[] = [
    "use_similarity_guard",
    "context_turns",
    "similarity_threshold",
    "guard_message",
    "match_count",
    "match_threshold",
    "fts_weight",
    "vector_weight",
    "rrf_k",
    "hybrid_top_k",
  ];

  const now = new Date().toISOString();
  for (const key of keys) {
    const value = partial[key];
    if (value === undefined) continue;
    const valueStr = key === "use_similarity_guard" ? (value ? "true" : "false") : String(value);
    const { error } = await supabase
      .from("rag_settings")
      .upsert(
        { key, value: valueStr, updated_at: now },
        { onConflict: "key" }
      );

    if (error) {
      LOG("updateRagSettings error", key, error.message);
      return { ok: false, error: error.message };
    }
  }

  LOG("updateRagSettings ok", Object.keys(partial));
  return getRagSettings();
}
