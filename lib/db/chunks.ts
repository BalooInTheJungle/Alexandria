/**
 * Insertion de chunks (content, embedding, content_fr, embedding_fr).
 */

import { createClient } from "@/lib/supabase/server";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[db/chunks]", msg, ...args);

export type ChunkInsert = {
  document_id: string;
  content: string;
  position: number;
  page?: number | null;
  section_title?: string | null;
  embedding: number[];
  content_fr?: string | null;
  embedding_fr?: number[] | null;
};

const CHUNK_BATCH_SIZE = 20;

export async function insertChunks(rows: ChunkInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = await createClient();
  const payload = rows.map((r) => ({
    document_id: r.document_id,
    content: r.content,
    position: r.position,
    page: r.page ?? null,
    section_title: r.section_title ?? null,
    embedding: r.embedding,
    content_fr: r.content_fr ?? null,
    embedding_fr: r.embedding_fr ?? null,
  }));

  LOG("insertChunks", { count: payload.length, document_id: rows[0]?.document_id });

  for (let i = 0; i < payload.length; i += CHUNK_BATCH_SIZE) {
    const batch = payload.slice(i, i + CHUNK_BATCH_SIZE);
    LOG("insertChunks batch", { from: i, to: i + batch.length });
    const { error } = await supabase.from("chunks").insert(batch);
    if (error) {
      LOG("insertChunks batch error", { from: i, message: error.message });
      throw error;
    }
  }

  LOG("insertChunks ok", { batches: Math.ceil(payload.length / CHUNK_BATCH_SIZE) });
}

/** Nombre de chunks pour un document (pour réponse API upload en cas de skip doublon). */
export async function countChunksByDocumentId(documentId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("chunks")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId);
  if (error) {
    LOG("countChunksByDocumentId error", error.message);
    throw error;
  }
  return count ?? 0;
}
