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

/** Bornes de validation pour PATCH admin. Valeur hors bornes → 400 sans modifier la base. */
export const RAG_SETTINGS_BOUNDS: Record<
  keyof RagSettings,
  { min?: number; max?: number; maxLength?: number; type: "integer" | "float" | "string" }
> = {
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

/** Résultat de la validation d’un body PATCH : soit les mises à jour à appliquer, soit une erreur. */
export type ValidateRagSettingsResult =
  | { ok: true; updates: Record<string, string> }
  | { ok: false; error: string };

/**
 * Valide un body partiel pour PATCH rag_settings. N’accepte que les clés connues ; valeurs hors bornes → error.
 * En cas d’erreur, aucune modification en base ne doit être faite.
 */
export function validateRagSettingsPatch(body: unknown): ValidateRagSettingsResult {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be an object" };
  }
  const updates: Record<string, string> = {};
  const keys = Object.keys(RAG_SETTINGS_BOUNDS) as (keyof RagSettings)[];
  for (const key of keys) {
    const v = (body as Record<string, unknown>)[key];
    if (v === undefined) continue;
    const bounds = RAG_SETTINGS_BOUNDS[key];
    if (bounds.type === "string") {
      const s = typeof v === "string" ? v : String(v);
      if (bounds.maxLength != null && s.length > bounds.maxLength) {
        return { ok: false, error: `${key} must be at most ${bounds.maxLength} characters` };
      }
      updates[key] = s;
      continue;
    }
    const n = bounds.type === "integer" ? parseInt(String(v), 10) : Number(v);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${key} must be a valid number` };
    }
    if (bounds.min != null && n < bounds.min) {
      return { ok: false, error: `${key} must be >= ${bounds.min}` };
    }
    if (bounds.max != null && n > bounds.max) {
      return { ok: false, error: `${key} must be <= ${bounds.max}` };
    }
    updates[key] = String(bounds.type === "integer" ? Math.round(n) : n);
  }
  return { ok: true, updates };
}

/**
 * Met à jour la table rag_settings avec les paires key/value fournies.
 * Chaque clé doit déjà exister en base (UPDATE uniquement, pas d’INSERT).
 */
export async function updateRagSettings(updates: Record<string, string>): Promise<void> {
  if (Object.keys(updates).length === 0) return;
  const supabase = await createClient();
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(updates)) {
    const { error } = await supabase
      .from("rag_settings")
      .update({ value, updated_at: now })
      .eq("key", key);
    if (error) {
      LOG("updateRagSettings error", key, error.message);
      throw new Error(`Failed to update rag_settings.${key}: ${error.message}`);
    }
  }
  LOG("updateRagSettings", { keys: Object.keys(updates) });
}
