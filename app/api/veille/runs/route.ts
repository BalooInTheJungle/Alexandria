import { NextResponse } from "next/server";
import { listVeilleRuns } from "@/lib/db/veille";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/veille/runs", msg, ...args);

/**
 * GET /api/veille/runs
 * Liste des runs (statut, dates). Query: limit (défaut 50).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
    LOG("GET", { limit });
    const runs = await listVeilleRuns(limit);
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
