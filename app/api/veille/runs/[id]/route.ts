import { NextResponse } from "next/server";
import { getRunById } from "@/lib/db/veille";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/veille/runs/[id]", msg, ...args);

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/veille/runs/[id]
 * Statut d'une run (pending / running / completed / failed).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    LOG("GET", { id });
    const run = await getRunById(id);
    if (!run) {
      LOG("not found", { id });
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    LOG("ok", { id, status: run.status });
    return NextResponse.json(run);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Get run failed" },
      { status: 500 }
    );
  }
}
