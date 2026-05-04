/**
 * Découpage du texte en chunks (sections) pour le RAG.
 * Taille cible ~400 caractères, recouvrement 50.
 */

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[ingestion/chunk]", msg, ...args);

const TARGET_CHUNK_SIZE = 400;
const OVERLAP = 50;

export type ChunkSegment = {
  content: string;
  position: number;
  page: number | null;
  section_title: string | null;
};

/**
 * Découpe le texte en segments (par paragraphes si possible, sinon par fenêtre glissante).
 */
export function chunkText(text: string): ChunkSegment[] {
  const trimmed = text.trim();
  if (!trimmed) {
    LOG("chunkText empty");
    return [];
  }
  const segments: ChunkSegment[] = [];
  const paragraphs = trimmed.split(/\n\s*\n/).filter((p) => p.trim());
  let position = 0;
  if (paragraphs.length > 0) {
    let current = "";
    let currentLen = 0;
    for (const p of paragraphs) {
      const block = p.trim() + "\n\n";
      if (currentLen + block.length <= TARGET_CHUNK_SIZE && currentLen > 0) {
        current += block;
        currentLen += block.length;
      } else {
        if (current) {
          segments.push({
            content: current.trim(),
            position,
            page: null,
            section_title: null,
          });
          position++;
          const overlapStart = Math.max(0, current.length - OVERLAP);
          current = current.slice(overlapStart) + block;
          currentLen = current.length;
        } else {
          current = block;
          currentLen = block.length;
        }
      }
    }
    if (current.trim()) {
      segments.push({
        content: current.trim(),
        position,
        page: null,
        section_title: null,
      });
    }
  } else {
    for (let i = 0; i < trimmed.length; i += TARGET_CHUNK_SIZE - OVERLAP) {
      const content = trimmed.slice(i, i + TARGET_CHUNK_SIZE).trim();
      if (content)
        segments.push({
          content,
          position: segments.length,
          page: null,
          section_title: null,
        });
    }
  }
  LOG("chunkText", { inputLength: text.length, chunks: segments.length });
  return segments;
}
