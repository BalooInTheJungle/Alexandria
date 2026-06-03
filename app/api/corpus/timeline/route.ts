import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type TimelinePoint = { year: number; count: number };

export async function GET() {
  console.log("[API] GET /api/corpus/timeline input: {}");
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase.rpc("get_timeline_by_year", { year_min: 2000, year_max: 2030 });

    if (error) {
      console.error("[API] GET /api/corpus/timeline error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const timeline: TimelinePoint[] = (data ?? []).map((r: { year: number; count: number }) => ({
      year: r.year,
      count: r.count,
    }));

    console.log("[API] GET /api/corpus/timeline result:", { years: timeline.length, total: data?.length });
    return NextResponse.json({ timeline });
  } catch (e) {
    console.error("[API] GET /api/corpus/timeline error:", e);
    return NextResponse.json({ error: "Timeline failed" }, { status: 500 });
  }
}
