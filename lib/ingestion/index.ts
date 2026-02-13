/**
 * Orchestration : parse PDF → chunk → embed (EN + FR POC) → insert documents + chunks.
 * Utilisé par l'API upload (un ou plusieurs PDF).
 */

import { parsePdfBuffer } from "./parse-pdf";
import { chunkText } from "./chunk";
import { embedQuery } from "@/lib/rag/embed";
import { createDocument, updateDocument } from "@/lib/db/documents";
import { insertChunks } from "@/lib/db/chunks";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[ingestion]", msg, ...args);

export type IngestPdfResult = {
  documentId: string;
  status: "done" | "error";
  chunksCount: number;
  error?: string;
};

/**
 * Ingère un PDF (buffer) : crée le document, parse, chunk, embed, insert chunks.
 * storagePath : chemin logique (ex. "upload/<id>.pdf"). Le fichier n'est pas conservé après ingestion.
 * titleOption : titre à utiliser si le PDF n'en fournit pas (ex. nom de fichier).
 */
export async function ingestPdfBuffer(
  buffer: Buffer,
  storagePath: string,
  titleOption?: string
): Promise<IngestPdfResult> {
  const doc = await createDocument({
    storage_path: storagePath,
    status: "processing",
    title: titleOption ?? null,
  });
  const documentId = doc.id;

  try {
    LOG("ingestPdfBuffer start", { documentId });
    const { text, numpages } = await parsePdfBuffer(buffer);
    if (!text) {
      await updateDocument(documentId, {
        status: "error",
        error_message: "No text extracted from PDF",
        ingestion_log: { numpages, chunks_count: 0 },
      });
      return { documentId, status: "error", chunksCount: 0, error: "No text extracted" };
    }

    const segments = chunkText(text);
    if (segments.length === 0) {
      await updateDocument(documentId, {
        status: "done",
        ingestion_log: { numpages, chunks_count: 0, ingested_at: new Date().toISOString() },
      });
      return { documentId, status: "done", chunksCount: 0 };
    }

    const chunks: {
      document_id: string;
      content: string;
      position: number;
      page: number | null;
      section_title: string | null;
      embedding: number[];
      content_fr: string | null;
      embedding_fr: number[] | null;
    }[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const embedding = await embedQuery(seg.content);
      chunks.push({
        document_id: documentId,
        content: seg.content,
        position: seg.position,
        page: seg.page,
        section_title: seg.section_title,
        embedding,
        content_fr: seg.content,
        embedding_fr: embedding,
      });
    }

    await insertChunks(chunks);
    await updateDocument(documentId, {
      status: "done",
      ingestion_log: {
        numpages,
        chunks_count: chunks.length,
        ingested_at: new Date().toISOString(),
      },
    });
    LOG("ingestPdfBuffer done", { documentId, chunksCount: chunks.length });
    return { documentId, status: "done", chunksCount: chunks.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    LOG("ingestPdfBuffer error", { documentId, err: msg });
    await updateDocument(documentId, {
      status: "error",
      error_message: msg.slice(0, 1000),
      ingestion_log: { error: msg },
    });
    return {
      documentId,
      status: "error",
      chunksCount: 0,
      error: msg,
    };
  }
}
