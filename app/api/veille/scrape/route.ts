import { NextResponse } from "next/server";
import { createRun } from "@/lib/db/veille";
import { runVeillePipeline } from "@/lib/veille/run-pipeline";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/veille/scrape", msg, ...args);

/**
 * POST /api/veille/scrape
 * Déclenche une run de la pipeline veille (toutes les sources).
 * Body: { wait?: boolean } — si true, attend la fin de la run (pour tests).
 * Sinon retourne 202 et lance la pipeline en arrière-plan.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const wait = Boolean(body?.wait);
    LOG("POST", { wait });

    const run = await createRun();
    const runId = run.id;

    if (wait) {
      LOG("running pipeline (wait=true)");
      await runVeillePipeline(runId);
      LOG("pipeline finished");
      const { getRunById } = await import("@/lib/db/veille");
      const updated = await getRunById(runId);
      return NextResponse.json({
        runId,
        status: updated?.status ?? run.status,
        message: "Run completed (wait mode)",
      });
    }

    void runVeillePipeline(runId).catch((err) =>
      console.error("[API] POST /api/veille/scrape pipeline error", err)
    );
    LOG("pipeline started in background", { runId });
    return NextResponse.json(
      { runId, status: "pending", message: "Run started" },
      { status: 202 }
    );
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Start scrape failed" },
      { status: 500 }
    );
  }
}
