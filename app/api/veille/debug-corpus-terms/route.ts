/**
 * GET /api/veille/debug-corpus-terms
 * Debug : retourne la réponse brute de get_corpus_top_terms pour diagnostiquer le score heuristique.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("get_corpus_top_terms", { lim: 10 });

    const rawKeys = data?.[0] ? Object.keys(data[0]) : [];
    const words = (data ?? []).map((r: Record<string, unknown>) => r.word ?? r.w);

    return NextResponse.json({
      error: error?.message ?? null,
      rawRowCount: (data ?? []).length,
      rawFirstRowKeys: rawKeys,
      rawFirstRow: data?.[0] ?? null,
      parsedWords: words,
      parsedWordsCount: words.filter(Boolean).length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
