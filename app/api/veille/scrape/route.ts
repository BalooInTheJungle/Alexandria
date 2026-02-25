import { after } from "next/server";
import { NextResponse } from "next/server";
import { createRun } from "@/lib/db/veille";
import { runVeillePipeline } from "@/lib/veille/run-pipeline";

/** Timeout étendu pour la pipeline veille (Vercel Pro: 60s par défaut, max 300s). */
export const maxDuration = 300;

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/scrape]", new Date().toISOString(), msg, ...args);

/**
 * POST /api/veille/scrape
 * Crée une run, retourne 202 avec runId immédiatement, puis exécute la pipeline via after().
 * Le frontend peut poller le statut et utiliser le bouton Stop (POST /api/veille/runs/[id]/stop).
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  LOG("POST request received");

  try {
    const run = await createRun();
    const runId = run.id;
    LOG("run created", { runId, status: run.status, elapsedMs: Date.now() - startTime });

    after(async () => {
      try {
        await runVeillePipeline(runId);
      } catch (err) {
        console.error("[veille/scrape] pipeline error:", new Date().toISOString(), err);
      }
    });

    const elapsed = Date.now() - startTime;
    LOG("returning 202", { runId, elapsedMs: elapsed });
    return NextResponse.json(
      {
        runId,
        status: "pending",
        message: "Run démarrée. Utilisez le bouton Stop pour interrompre.",
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
