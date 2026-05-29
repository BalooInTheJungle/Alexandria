import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type TimelinePoint = { year: number; count: number };

export async function GET() {
  console.log("[API] GET /api/corpus/timeline input: {}");
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("documents")
      .select("published_at")
      .eq("status", "done")
      .not("published_at", "is", null)
      .limit(10000);

    if (error) {
      console.error("[API] GET /api/corpus/timeline error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const freq: Record<number, number> = {};
    for (const row of data ?? []) {
      const year = new Date(row.published_at as string).getFullYear();
      if (year >= 2000 && year <= 2030) freq[year] = (freq[year] ?? 0) + 1;
    }

    const timeline: TimelinePoint[] = Object.entries(freq)
      .map(([y, c]) => ({ year: Number(y), count: c }))
      .sort((a, b) => a.year - b.year);

    console.log("[API] GET /api/corpus/timeline result:", { years: timeline.length, total: data?.length });
    return NextResponse.json({ timeline });
  } catch (e) {
    console.error("[API] GET /api/corpus/timeline error:", e);
    return NextResponse.json({ error: "Timeline failed" }, { status: 500 });
  }
}
