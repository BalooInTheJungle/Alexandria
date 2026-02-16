import { NextResponse } from "next/server";
import { listVeilleRunsWithCounts, listVeilleRuns } from "@/lib/db/veille";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/veille/runs", msg, ...args);

/**
 * GET /api/veille/runs
 * Liste des runs (statut, dates, items_count). Query: limit (défaut 50).
 * Si l'RPC get_veille_runs_with_counts n'existe pas, fallback sans items_count.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
    LOG("GET", { limit });
    let runs: { id: string; status: string; started_at?: string | null; completed_at?: string | null; error_message?: string | null; created_at?: string; items_count?: number }[];
    try {
      runs = await listVeilleRunsWithCounts(limit);
    } catch (rpcErr) {
      LOG("RPC fallback", rpcErr);
      const plain = await listVeilleRuns(limit);
      runs = plain.map((r) => ({ ...r, items_count: 0 }));
    }
    LOG("ok", { count: runs.length });
    return NextResponse.json(runs);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List runs failed" },
      { status: 500 }
    );
  }
}
