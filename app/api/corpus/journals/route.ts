import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type JournalStat = { journal: string; count: number };

const TOP_N = 20;

export async function GET() {
  console.log("[API] GET /api/corpus/journals input:", { topN: TOP_N });
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("get_journal_counts", { top_n: TOP_N });

    if (error) {
      console.error("[API] GET /api/corpus/journals error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const journals: JournalStat[] = (data ?? []).map((r: { journal: string; count: number }) => ({
      journal: r.journal,
      count: r.count,
    }));

    console.log("[API] GET /api/corpus/journals result:", { journals: journals.length });
    return NextResponse.json({ journals });
  } catch (e) {
    console.error("[API] GET /api/corpus/journals error:", e);
    return NextResponse.json({ error: "Journals failed" }, { status: 500 });
  }
}
