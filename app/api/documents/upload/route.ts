import { NextResponse } from "next/server";
import { ingestPdfBuffer } from "@/lib/ingestion";
import { randomUUID } from "crypto";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/documents/upload", msg, ...args);

const MAX_FILES = 10;
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

export type UploadResultItem = {
  filename: string;
  documentId: string;
  status: "done" | "error";
  chunksCount: number;
  error?: string;
  /** true si le document était déjà en base (même DOI), pas de doublon créé. */
  skipped?: boolean;
};

/**
 * POST /api/documents/upload
 * Body: multipart/form-data avec un ou plusieurs champs "file" ou "files" (PDF).
 * Réponse: { results: UploadResultItem[] }
 * Les PDF ne sont pas conservés après ingestion (traitement en mémoire).
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files: { name: string; buffer: Buffer }[] = [];

    for (const [key, entry] of Array.from(formData.entries())) {
      if (key !== "file" && key !== "files") continue;
      if (entry instanceof File) {
        if (entry.type !== "application/pdf") {
          LOG("skip non-PDF", { name: entry.name, type: entry.type });
          continue;
        }
        if (entry.size > MAX_FILE_SIZE) {
          LOG("skip too large", { name: entry.name, size: entry.size });
          continue;
        }
        const buf = Buffer.from(await entry.arrayBuffer());
        files.push({ name: entry.name || "document.pdf", buffer: buf });
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No PDF file(s) in body. Send multipart/form-data with 'file' or 'files'." },
        { status: 400 }
      );
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES} files per request.` },
        { status: 400 }
      );
    }

    LOG("upload", { count: files.length, names: files.map((f) => f.name) });
    const results: UploadResultItem[] = [];

    for (const { name, buffer } of files) {
      const storagePath = `upload/${randomUUID()}.pdf`;
      const result = await ingestPdfBuffer(buffer, storagePath, name.replace(/\.pdf$/i, "") || name);
      results.push({
        filename: name,
        documentId: result.documentId,
        status: result.status,
        chunksCount: result.chunksCount,
        error: result.error,
        skipped: result.skipped,
      });
    }

    LOG("upload done", { results: results.map((r) => ({ filename: r.filename, status: r.status, chunks: r.chunksCount })) });
    return NextResponse.json({ results });
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
