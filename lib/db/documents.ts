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
