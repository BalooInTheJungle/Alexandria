/**
 * Format des sources pour l’affichage (titre, DOI, chemin, section).
 * Pas de lien externe : document local (data/pdfs/).
 */

import type { MatchedChunk } from "./search";

export type SourceForDisplay = {
  index: number;
  title: string | null;
  doi: string | null;
  storage_path: string;
  section_title: string | null;
  page: number | null;
  excerpt: string;
  similarity?: number;
};

/**
 * Transforme les chunks matchés en liste de sources pour l’UI ([1], [2]…).
 * Déduplique par document et garde le meilleur chunk par doc pour l’excerpt.
 */
export function chunksToSources(chunks: MatchedChunk[]): SourceForDisplay[] {
  const byDoc = new Map<string, MatchedChunk>();
  for (const c of chunks) {
    const existing = byDoc.get(c.document_id);
    if (!existing || (c.similarity > existing.similarity)) {
      byDoc.set(c.document_id, c);
    }
  }
  const list = Array.from(byDoc.values());
  return list.map((c, i) => ({
    index: i + 1,
    title: c.doc_title ?? null,
    doi: c.doc_doi ?? null,
    storage_path: c.doc_storage_path,
    section_title: c.section_title ?? null,
    page: c.page ?? null,
    excerpt: c.content.slice(0, 200) + (c.content.length > 200 ? "…" : ""),
    similarity: c.similarity,
  }));
}
