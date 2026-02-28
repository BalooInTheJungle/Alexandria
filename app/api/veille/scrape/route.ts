import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { createRun } from "@/lib/db/veille";
import { runVeillePrepare } from "@/lib/veille/run-prepare";

/** Timeout étendu pour la phase préparation (Vercel Pro: 60s par défaut, max 300s). */
export const maxDuration = 300;

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/scrape]", new Date().toISOString(), msg, ...args);

const DEFAULT_BATCH_SIZE = 10;

/** URL de base pour les appels internes (fetch process-batch). Vercel: VERCEL_URL, sinon request. */
function getBaseUrl(request: Request): string {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  try {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://localhost:3000";
  }
}

/**
 * POST /api/veille/scrape
 * Crée une run, retourne 202 avec runId immédiatement.
 * Phase 1 (waitUntil) : runPrepare (fetch sources, extract URLs, insert veille_run_urls).
 * Phase 2 : premier lot via POST /api/veille/process-batch (chaînage automatique si hasMore).
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  LOG("POST request received");

  try {
    const run = await createRun();
    const runId = run.id;
    LOG("run created", { runId, status: run.status, elapsedMs: Date.now() - startTime });

    waitUntil(
      (async () => {
        try {
          const { ok, count } = await runVeillePrepare(runId);
          if (!ok || count === 0) {
            LOG("prepare done, no URLs to process");
            return;
          }
          const base = getBaseUrl(request);
          const processBatchUrl = `${base}/api/veille/process-batch`;
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          const cookie = request.headers.get("cookie");
          if (cookie) headers["Cookie"] = cookie;
          const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
          if (bypass) headers["x-vercel-protection-bypass"] = bypass;
          LOG("triggering first batch", { count, processBatchUrl, hasBypass: !!bypass });
          const fetchRes = await fetch(processBatchUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ runId, batchSize: DEFAULT_BATCH_SIZE }),
          });
          LOG("first batch response", { status: fetchRes.status, ok: fetchRes.ok });
        } catch (err) {
          console.error("[veille/scrape] prepare/trigger error:", new Date().toISOString(), err);
        }
      })()
    );

    const elapsed = Date.now() - startTime;
    LOG("returning 202", { runId, elapsedMs: elapsed });
    return NextResponse.json(
      {
        runId,
        status: "pending",
        message: "Run démarrée. Utilisez le bouton Arrêter pour interrompre.",
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
