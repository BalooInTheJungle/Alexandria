import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/veille/stats", msg, ...args);

/**
 * GET /api/veille/stats
 * Global veille stats: total items, pertinent (>=80%), read.
 */
export async function GET() {
  LOG("input", {});
  try {
    const supabase = createAdminClient();

    const [totalRes, pertinentRes, readRes] = await Promise.all([
      supabase.from("veille_items").select("id", { count: "exact", head: true }),
      supabase.from("veille_items").select("id", { count: "exact", head: true }).gte("similarity_score", 0.80),
      supabase.from("veille_items").select("id", { count: "exact", head: true }).not("read_at", "is", null),
    ]);

    const stats = {
      total:     totalRes.count     ?? 0,
      pertinent: pertinentRes.count ?? 0,
      read:      readRes.count      ?? 0,
    };

    LOG("result", stats);
    return NextResponse.json(stats);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json({ error: "Stats failed" }, { status: 500 });
  }
}
