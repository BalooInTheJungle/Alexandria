import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type JournalStat = { journal: string; count: number };

const TOP_N = 20;

export async function GET() {
  console.log("[API] GET /api/corpus/journals input:", { topN: TOP_N });
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("documents")
      .select("journal")
      .eq("status", "done")
      .not("journal", "is", null);

    if (error) {
      console.error("[API] GET /api/corpus/journals error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const freq: Record<string, number> = {};
    for (const row of data ?? []) {
      const j = (row.journal as string).trim();
      if (j) freq[j] = (freq[j] ?? 0) + 1;
    }

    const journals: JournalStat[] = Object.entries(freq)
      .map(([journal, count]) => ({ journal, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_N);

    console.log("[API] GET /api/corpus/journals result:", { journals: journals.length });
    return NextResponse.json({ journals });
  } catch (e) {
    console.error("[API] GET /api/corpus/journals error:", e);
    return NextResponse.json({ error: "Journals failed" }, { status: 500 });
  }
}
