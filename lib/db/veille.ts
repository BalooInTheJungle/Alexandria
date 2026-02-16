/**
 * Lecture et écriture veille_runs, veille_items (avec nom source + indicateur intégré en DB).
 */

import { createClient } from "@/lib/supabase/server";
import type { VeilleRun, VeilleItem } from "@/lib/db/types";

const LOG = (msg: string, ...args: unknown[]) => console.log("[db/veille]", msg, ...args);

export type VeilleRunRow = VeilleRun;

export type VeilleRunWithCount = VeilleRunRow & { items_count: number };

export type VeilleItemWithMeta = VeilleItem & {
  source_name: string | null;
  /** document_id si l'article est déjà ingéré (match DOI avec documents) */
  document_id: string | null;
};

export async function listVeilleRuns(limit = 50): Promise<VeilleRunRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("veille_runs")
    .select("id, status, started_at, completed_at, error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    LOG("listVeilleRuns error", error.message);
    throw error;
  }
  LOG("listVeilleRuns", { count: (data ?? []).length, limit });
  return (data ?? []) as VeilleRunRow[];
}

/** Liste des runs avec nombre d'items par run (pour Historique). Utilise l'RPC get_veille_runs_with_counts. */
export async function listVeilleRunsWithCounts(limit = 50): Promise<VeilleRunWithCount[]> {
  const supabase = await createClient();
  const lim = Math.max(1, Math.min(100, limit));
  const { data, error } = await supabase.rpc("get_veille_runs_with_counts", { lim });
  if (error) {
    LOG("listVeilleRunsWithCounts error", error.message);
    throw error;
  }
  const rows = (data ?? []) as (VeilleRunRow & { items_count: string })[];
  LOG("listVeilleRunsWithCounts", { count: rows.length });
  return rows.map((r) => ({
    ...r,
    items_count: typeof r.items_count === "number" ? r.items_count : parseInt(String(r.items_count), 10) || 0,
  }));
}

export type ListVeilleItemsOptions = {
  runId?: string;
  sourceId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Liste les veille_items avec le nom de la source et document_id si match DOI avec documents.
 */
export async function listVeilleItems(
  options: ListVeilleItemsOptions = {}
): Promise<VeilleItemWithMeta[]> {
  const { runId, sourceId, limit = 100, offset = 0 } = options;
  const supabase = await createClient();

  let query = supabase
    .from("veille_items")
    .select(
      `
      id, run_id, source_id, url, title, authors, doi, abstract, published_at,
      heuristic_score, similarity_score, last_error, created_at,
      sources!inner(name)
    `
    )
    .order("similarity_score", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (runId) query = query.eq("run_id", runId);
  if (sourceId) query = query.eq("source_id", sourceId);

  const { data: items, error } = await query;

  if (error) {
    LOG("listVeilleItems error", error.message);
    throw error;
  }
  LOG("listVeilleItems", { count: (items ?? []).length, runId, sourceId, limit, offset });
  type Row = VeilleItem & {
    sources: { name: string | null }[] | { name: string | null };
  };
  const rows = (items ?? []) as Row[];

  const dois = Array.from(
    new Set(rows.map((r) => r.doi).filter((d): d is string => Boolean(d)))
  );
  const doiToDocumentId = new Map<string, string>();
  if (dois.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, doi")
      .in("doi", dois);
    for (const d of docs ?? []) {
      if (d.doi) doiToDocumentId.set(d.doi, d.id);
    }
  }

  const sourceName = (r: Row): string | null => {
    const s = r.sources;
    if (!s) return null;
    const obj = Array.isArray(s) ? s[0] : s;
    return obj?.name ?? null;
  };

  return rows.map((r) => ({
    id: r.id,
    run_id: r.run_id,
    source_id: r.source_id,
    url: r.url,
    title: r.title ?? null,
    authors: r.authors ?? null,
    doi: r.doi ?? null,
    abstract: r.abstract ?? null,
    published_at: r.published_at ?? null,
    heuristic_score: r.heuristic_score ?? null,
    similarity_score: r.similarity_score ?? null,
    last_error: r.last_error ?? null,
    created_at: r.created_at,
    source_name: sourceName(r),
    document_id: r.doi ? doiToDocumentId.get(r.doi) ?? null : null,
  }));
}

/** Crée une run (status pending). Utilisé par POST /api/veille/scrape. */
export async function createRun(): Promise<VeilleRunRow> {
  const supabase = await createClient();
  LOG("createRun");
  const { data, error } = await supabase
    .from("veille_runs")
    .insert({ status: "pending" })
    .select("id, status, started_at, completed_at, error_message, created_at")
    .single();

  if (error) {
    LOG("createRun error", error.message);
    throw error;
  }
  LOG("createRun ok", { id: data.id });
  return data as VeilleRunRow;
}

/** Récupère une run par id. Utilisé par GET /api/veille/runs/[id]. */
export async function getRunById(id: string): Promise<VeilleRunRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("veille_runs")
    .select("id, status, started_at, completed_at, error_message, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    LOG("getRunById error", id, error.message);
    throw error;
  }
  LOG("getRunById", { id, found: !!data, status: data?.status });
  return data as VeilleRunRow | null;
}
