/**
 * GET /api/corpus/author-articles/[id]/similar
 *
 * Retourne les N articles du corpus les plus similaires
 * à l'article auteur identifié par [id].
 *
 * Flow :
 *   1. Récupère l'embedding du 1er chunk de l'article auteur (rapide, ~35ms).
 *   2. Appelle la RPC match_corpus_docs avec cet embedding.
 *      → utilise l'index IVFFlat, filtre is_author_article=false
 *      → agrège par document (best_similarity)
 *   3. Retourne les top N documents corpus.
 *
 * Query params :
 *   limit : nombre de résultats (défaut 10, max 30)
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type SimilarCorpusDoc = {
  document_id: string;
  title: string | null;
  journal: string | null;
  year: number | null;
  doi: string | null;
  best_similarity: number;
  best_chunk: string | null;
};

export type SimilarDocsResponse = {
  author_doc_id: string;
  author_title: string | null;
  results: SimilarCorpusDoc[];
};

/** Parse un vecteur pgvector retourné comme string "[0.1,0.2,...]" ou déjà en array. */
function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as number[];
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Calcule l'embedding moyen de N vecteurs 384D.
 * Plus représentatif qu'un seul chunk (évite les faux positifs sur texte espacé).
 */
function averageEmbeddings(embeddings: number[][]): number[] {
  const dim = 384;
  const sum = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) sum[i] += emb[i];
  }
  return sum.map((v) => v / embeddings.length);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const limit = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10)));

  console.log("[API] GET /api/corpus/author-articles/[id]/similar input:", { id, limit });

  try {
    const supabase = createAdminClient();

    // ── 1. Vérifier que l'article existe et est bien is_author_article ────────
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, title, is_author_article")
      .eq("id", id)
      .eq("is_author_article", true)
      .eq("status", "done")
      .maybeSingle();

    if (docError) {
      console.error("[API] similar doc check error:", docError.message);
      return NextResponse.json({ error: docError.message }, { status: 500 });
    }
    if (!doc) {
      console.warn("[API] similar: author article not found:", id);
      return NextResponse.json({ error: "Author article not found" }, { status: 404 });
    }

    // ── 2. Récupérer TOUS les embeddings et calculer la moyenne ─────────────
    //    Avantage vs position=0 : évite les faux positifs sur texte espacé
    //    (les headers/pages de garde des vieux PDFs biaisent le matching).
    const { data: chunkRows, error: chunkError } = await supabase
      .from("chunks")
      .select("embedding")
      .eq("document_id", id)
      .not("embedding", "is", null);

    if (chunkError) {
      console.error("[API] similar chunk fetch error:", chunkError.message);
      return NextResponse.json({ error: chunkError.message }, { status: 500 });
    }
    if (!chunkRows?.length) {
      console.warn("[API] similar: no embeddings for doc:", id);
      return NextResponse.json({ error: "No embedding available for this article" }, { status: 422 });
    }

    const validEmbeddings = chunkRows
      .map((r) => parseVector(r.embedding))
      .filter((v): v is number[] => v !== null && v.length === 384);

    if (!validEmbeddings.length) {
      console.error("[API] similar: no valid embeddings for doc:", id);
      return NextResponse.json({ error: "Invalid embedding format" }, { status: 500 });
    }

    const queryEmbedding = averageEmbeddings(validEmbeddings);

    console.log("[API] similar: averaged embeddings count:", validEmbeddings.length);

    // ── 3. Recherche corpus via RPC (IVFFlat index) ──────────────────────────
    const { data: rpcData, error: rpcError } = await supabase
      .rpc("match_corpus_docs", {
        query_embedding:  queryEmbedding,
        match_count:      limit,
        chunk_candidates: limit * 8,   // surééchantillonnage pour la dédup par doc
        match_threshold:  0.3,
      });

    if (rpcError) {
      console.error("[API] similar rpc error:", rpcError.message);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const results: SimilarCorpusDoc[] = (rpcData ?? []).map((row: {
      document_id: string;
      title: string | null;
      journal: string | null;
      published_at: string | null;
      doi: string | null;
      best_similarity: number;
      best_chunk: string | null;
    }) => ({
      document_id:     row.document_id,
      title:           row.title    ?? null,
      journal:         row.journal  ?? null,
      year:            row.published_at ? new Date(row.published_at).getFullYear() : null,
      doi:             row.doi      ?? null,
      best_similarity: Math.round(row.best_similarity * 1000) / 1000,
      best_chunk:      row.best_chunk ? row.best_chunk.slice(0, 300) : null,
    }));

    console.log("[API] GET /api/corpus/author-articles/[id]/similar result:", {
      author_doc_id: id,
      resultsCount:  results.length,
      topScore:      results[0]?.best_similarity ?? null,
    });

    return NextResponse.json({
      author_doc_id: id,
      author_title:  (doc as { title?: string | null }).title ?? null,
      results,
    } satisfies SimilarDocsResponse);

  } catch (e) {
    console.error("[API] GET /api/corpus/author-articles/[id]/similar error:", e);
    return NextResponse.json({ error: "Similar docs fetch failed" }, { status: 500 });
  }
}
