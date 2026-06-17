/**
 * Extraction de texte depuis un buffer PDF (Node).
 * Utilise pdf-parse v1 (API simple : pdfParse(buffer)).
 */

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[ingestion/parse-pdf]", msg, ...args);

export type ParsePdfResult = {
  text: string;
  numpages: number;
};

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsePdfResult> {
  LOG("parsePdfBuffer", { size: buffer.length });
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  const text = (result?.text ?? "").trim();
  const numpages = result?.numpages ?? 0;
  LOG("parsePdfBuffer done", { numpages, textLength: text.length });
  return { text, numpages };
}
