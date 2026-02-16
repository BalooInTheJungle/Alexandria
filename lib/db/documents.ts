/**
 * CRUD documents (métadonnées PDF, statut ingestion).
 */

import { createClient } from "@/lib/supabase/server";

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
