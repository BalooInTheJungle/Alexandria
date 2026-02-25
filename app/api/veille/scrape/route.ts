import { NextResponse } from "next/server";
import { createRun } from "@/lib/db/veille";
import { runVeillePipeline } from "@/lib/veille/run-pipeline";

/** Timeout étendu pour la pipeline veille (Vercel Pro: 60s par défaut, max 300s). */
export const maxDuration = 300;

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/scrape]", new Date().toISOString(), msg, ...args);

/**
 * POST /api/veille/scrape
 * Déclenche une run de la pipeline veille (toutes les sources).
 * Body: { wait?: boolean } — si true, attend la fin de la run (pour tests).
 * Sinon retourne 202 et lance la pipeline en arrière-plan.
 *
 * ⚠️ Sur Vercel (serverless) : la fonction s'arrête dès que la réponse est envoyée.
 * Le travail en arrière-plan (void runVeillePipeline) est alors interrompu.
 * La run reste "pending" car le pipeline n'a jamais pu s'exécuter.
 * Solution : utiliser wait: true (timeout 60s) ou un cron job dédié.
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  LOG("POST request received");

  try {
    const body = await request.json().catch(() => ({}));
    const wait = Boolean(body?.wait);
    LOG("body parsed", { wait, hasBody: !!body });

    const run = await createRun();
    const runId = run.id;
    LOG("run created", { runId, status: run.status, elapsedMs: Date.now() - startTime });

    if (wait) {
      LOG("wait=true: running pipeline synchronously");
      await runVeillePipeline(runId);
      const elapsed = Date.now() - startTime;
      LOG("pipeline finished", { runId, elapsedMs: elapsed });
      const { getRunById } = await import("@/lib/db/veille");
      const updated = await getRunById(runId);
      return NextResponse.json({
        runId,
        status: updated?.status ?? run.status,
        message: "Run completed (wait mode)",
        elapsedMs: elapsed,
      });
    }

    LOG("wait=false: starting pipeline in background (will be killed when response is sent on Vercel)");
    void runVeillePipeline(runId).catch((err) => {
      console.error("[veille/scrape] pipeline error:", new Date().toISOString(), err);
    });
    const elapsed = Date.now() - startTime;
    LOG("returning 202", { runId, elapsedMs: elapsed });
    return NextResponse.json(
      {
        runId,
        status: "pending",
        message: "Run started (background). Sur Vercel, les fonctions serverless s'arrêtent après la réponse : la pipeline peut être interrompue.",
      },
      { status: 202 }
    );
  } catch (e) {
    LOG("error", e);
    console.error("[veille/scrape] error:", new Date().toISOString(), e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Start scrape failed" },
      { status: 500 }
    );
  }
}
