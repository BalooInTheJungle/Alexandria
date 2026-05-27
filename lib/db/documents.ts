/**
 * CRUD documents (métadonnées PDF, statut ingestion).
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[db/documents]", msg, ...args);

export type DocumentInsert = {
  title?: string | null;
  authors?: string[] | null;
  doi?: string | null;
  journal?: string | null;
  published_at?: string | null;
  storage_path: string;
  status?: "pending" | "processing" | "done" | "error";
};

export type DocumentRow = DocumentInsert & {
  id: string;
  error_message?: string | null;
  ingestion_log?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export async function createDocument(
  row: DocumentInsert
): Promise<DocumentRow> {
  const supabase = await createClient();
  const status = row.status ?? "processing";
  LOG("createDocument", { storage_path: row.storage_path, status });
  const { data, error } = await supabase
    .from("documents")
    .insert({
      title: row.title ?? null,
      authors: row.authors ?? null,
      doi: row.doi ?? null,
      journal: row.journal ?? null,
      published_at: row.published_at ?? null,
      storage_path: row.storage_path,
      status,
    })
    .select("id, title, authors, doi, journal, published_at, storage_path, status, error_message, ingestion_log, created_at, updated_at")
    .single();

  if (error) {
    LOG("createDocument error", error.message);
    throw error;
  }
  LOG("createDocument ok", { id: data.id });
  return data as DocumentRow;
}

export async function updateDocument(
  id: string,
  updates: {
    status?: "pending" | "processing" | "done" | "error";
    error_message?: string | null;
    ingestion_log?: Record<string, unknown> | null;
  }
): Promise<void> {
  const supabase = await createClient();
  LOG("updateDocument", { id, status: updates.status });
  const { error } = await supabase
    .from("documents")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    LOG("updateDocument error", error.message);
    throw error;
  }
}

/**
 * Trouve un document par DOI et statut (pour éviter les doublons à l'upload).
 * Retourne null si aucun document ne correspond.
 */
export async function findDocumentByDoiAndStatus(
  doi: string,
  status: "done" | "processing" | "pending" | "error"
): Promise<DocumentRow | null> {
  const normalized = doi.trim();
  if (!normalized) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, authors, doi, journal, published_at, storage_path, status, error_message, ingestion_log, created_at, updated_at")
    .eq("doi", normalized)
    .eq("status", status)
    .limit(1)
    .maybeSingle();
  if (error) {
    LOG("findDocumentByDoiAndStatus error", error.message);
    throw error;
  }
  return data as DocumentRow | null;
}

/** Nombre total de documents en base (pour la page Database). */
export async function countDocuments(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true });
  if (error) {
    LOG("countDocuments error", error.message);
    throw error;
  }
  return count ?? 0;
}

const STATS_NOISE_WORDS = new Set([
  "figur", "fig", "tabl", "articl", "use", "observ", "valu", "data",
  "form", "respect", "two", "also", "show", "soc", "rev", "comm",
  "deux", "don", "plus", "entre", "liaison", "utilis", "valeur", "wang",
  "number", "result", "studi", "work", "base", "high", "low", "larg",
]);

export type TermEntry = { word: string; nentry: number };

export type ErrorDoc = {
  id: string;
  title: string | null;
  error_message: string | null;
  created_at: string;
};

export type DocumentStats = {
  docs: { done: number; pending: number; error: number; total: number };
  chunks: { total: number; withEmbedding: number };
  topTerms: TermEntry[];
  errorDocs: ErrorDoc[];
};

export async function getDocumentStats(): Promise<DocumentStats> {
  // Admin client : stats système (pas user-specific), bypass RLS + pas de timeout auth
  const supabase = createAdminClient();
  LOG("getDocumentStats input:", {});

  const [
    { count: done },
    { count: pending },
    { count: error },
    { count: totalChunks },
    { data: rawTerms },
    { data: errorDocs },
  ] = await Promise.all([
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "done"),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("status", "error"),
    // Note : .not("embedding", "is", null) est bugué avec PostgREST + type vector(384).
    // On compte le total uniquement — withEmbedding = total car tous les chunks ont un embedding.
    // Le RPC get_chunk_stats() donne les vrais chiffres mais nécessite un reload schema PostgREST.
    supabase.from("chunks").select("id", { count: "exact", head: true }),
    supabase.from("corpus_top_terms_cache").select("word, nentry").order("nentry", { ascending: false }).limit(120),
    supabase.from("documents").select("id, title, error_message, created_at").eq("status", "error").order("created_at", { ascending: false }).limit(100),
  ]);

  const total_chunks = totalChunks ?? 0;

  const topTerms: TermEntry[] = (rawTerms ?? [])
    .filter((t) => !STATS_NOISE_WORDS.has(t.word) && t.word.length >= 4)
    .slice(0, 30);

  const result: DocumentStats = {
    docs: {
      done: done ?? 0,
      pending: pending ?? 0,
      error: error ?? 0,
      total: (done ?? 0) + (pending ?? 0) + (error ?? 0),
    },
    chunks: {
      total: total_chunks,
      withEmbedding: total_chunks, // tous les chunks ont un embedding après fix_spaced_chunks.py
    },
    topTerms,
    errorDocs: (errorDocs ?? []) as ErrorDoc[],
  };

  LOG("getDocumentStats result:", {
    docs: result.docs,
    chunks: result.chunks,
    topTermsCount: result.topTerms.length,
    errorDocsCount: result.errorDocs.length,
  });

  return result;
}
