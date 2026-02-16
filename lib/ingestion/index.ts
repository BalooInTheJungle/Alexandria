/**
 * Orchestration : parse PDF → chunk → embed (EN + FR POC) → insert documents + chunks.
 * Utilisé par l'API upload (un ou plusieurs PDF).
 * Garde-fou : si le PDF contient un DOI déjà présent en base (document status = done), on skip l'ingestion.
 */

import { parsePdfBuffer } from "./parse-pdf";
import { chunkText } from "./chunk";
import { embedQuery } from "@/lib/rag/embed";
import { createDocument, updateDocument, findDocumentByDoiAndStatus } from "@/lib/db/documents";
import { insertChunks, countChunksByDocumentId } from "@/lib/db/chunks";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[ingestion]", msg, ...args);

/** Extrait le premier DOI trouvé dans le texte (pattern 10.xxxx/...). */
function extractDoiFromText(text: string): string | null {
  const match = text.match(/10\.\d{4,}(?:\.[\w.-]+)*\/[^\s]+/);
  if (!match) return null;
  return match[0].replace(/[.,;:)\]\s]+$/, "").trim() || null;
}

export type IngestPdfResult = {
  documentId: string;
  status: "done" | "error";
  chunksCount: number;
  error?: string;
  /** true si le document était déjà en base (DOI identique), pas de création. */
  skipped?: boolean;
};

/**
 * Ingère un PDF (buffer) : parse → si DOI déjà en base (done) → skip ; sinon crée le document, chunk, embed, insert.
 * storagePath : chemin logique (ex. "upload/<id>.pdf"). Le fichier n'est pas conservé après ingestion.
 * titleOption : titre à utiliser si le PDF n'en fournit pas (ex. nom de fichier).
 */
export async function ingestPdfBuffer(
  buffer: Buffer,
  storagePath: string,
  titleOption?: string
): Promise<IngestPdfResult> {
  let documentId: string | undefined;
  try {
    LOG("ingestPdfBuffer start", { storagePath: storagePath.slice(0, 30) });
    const { text, numpages } = await parsePdfBuffer(buffer);

    if (text) {
      const doi = extractDoiFromText(text);
      if (doi) {
        const existing = await findDocumentByDoiAndStatus(doi, "done");
        if (existing) {
          const chunksCount = await countChunksByDocumentId(existing.id);
          LOG("ingestPdfBuffer skip duplicate DOI", { doi: doi.slice(0, 40), existingId: existing.id });
          return {
            documentId: existing.id,
            status: "done",
            chunksCount,
            skipped: true,
          };
        }
      }
    }

    const doc = await createDocument({
      storage_path: storagePath,
      status: "processing",
      title: titleOption ?? null,
      doi: text ? extractDoiFromText(text) ?? undefined : undefined,
    });
    documentId = doc.id;

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
    if (documentId) {
      await updateDocument(documentId, {
        status: "error",
        error_message: msg.slice(0, 1000),
        ingestion_log: { error: msg },
      });
    }
    return {
      documentId: documentId ?? "",
      status: "error",
      chunksCount: 0,
      error: msg,
    };
  }
}
