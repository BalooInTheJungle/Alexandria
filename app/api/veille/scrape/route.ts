import { NextResponse } from "next/server";
import { createRun } from "@/lib/db/veille";
import { runVeillePipeline } from "@/lib/veille/run-pipeline";

/** Timeout étendu pour la pipeline veille (Vercel Pro: 60s par défaut, max 300s). */
export const maxDuration = 300;

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/scrape]", new Date().toISOString(), msg, ...args);

/**
 * POST /api/veille/scrape
 * Exécute la pipeline de façon synchrone (wait: true). Sur Vercel, after() n'existe pas en Next.js 14.
 * Le bouton Stop reste disponible via POST /api/veille/runs/[id]/stop si on passe en mode async plus tard.
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  LOG("POST request received");

  try {
    const run = await createRun();
    const runId = run.id;
    LOG("run created", { runId, status: run.status, elapsedMs: Date.now() - startTime });

    await runVeillePipeline(runId);

    const elapsed = Date.now() - startTime;
    LOG("pipeline finished", { runId, elapsedMs: elapsed });
    const { getRunById } = await import("@/lib/db/veille");
    const updated = await getRunById(runId);
    return NextResponse.json({
      runId,
      status: updated?.status ?? run.status,
      message: "Run terminée",
      elapsedMs: elapsed,
    });
  } catch (e) {
    LOG("error", e);
    console.error("[veille/scrape] error:", new Date().toISOString(), e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Start scrape failed" },
      { status: 500 }
    );
  }
}
