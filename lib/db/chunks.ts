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
  const { error } = await supabase.from("chunks").insert(payload);
  if (error) {
    LOG("insertChunks error", error.message);
    throw error;
  }
  LOG("insertChunks ok");
}
