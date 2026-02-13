/**
 * Extraction de texte depuis un buffer PDF (Node).
 * Utilise pdf-parse v2 (PDFParse avec data: buffer).
 */

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[ingestion/parse-pdf]", msg, ...args);

export type ParsePdfResult = {
  text: string;
  numpages: number;
};

export async function parsePdfBuffer(buffer: Buffer): Promise<ParsePdfResult> {
  LOG("parsePdfBuffer", { size: buffer.length });
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  if (typeof (parser as { destroy?: () => Promise<void> }).destroy === "function") {
    await (parser as { destroy: () => Promise<void> }).destroy();
  }
  const text = (result?.text ?? "").trim();
  const numpages = result?.total ?? 0;
  LOG("parsePdfBuffer done", { numpages, textLength: text.length });
  return { text, numpages };
}
