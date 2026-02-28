import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { runVeilleProcessBatch } from "@/lib/veille/run-process-batch";

/** Timeout étendu pour chaque lot (Vercel Pro: 60s par défaut, max 300s). */
export const maxDuration = 300;

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/process-batch]", new Date().toISOString(), msg, ...args);

const DEFAULT_BATCH_SIZE = 10;

/** URL de base pour le chaînage. Vercel: VERCEL_URL, sinon request. */
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
 * POST /api/veille/process-batch
 * Traite un lot d'URLs pour une run. Si hasMore, enchaîne le lot suivant via waitUntil.
 * Corps: { runId: string, batchSize?: number }
 */
export async function POST(request: Request) {
  LOG("POST received");
  try {
    const body = await request.json().catch(() => ({}));
    const runId = body?.runId as string | undefined;
    const batchSize = typeof body?.batchSize === "number" ? body.batchSize : DEFAULT_BATCH_SIZE;

    if (!runId || typeof runId !== "string") {
      return NextResponse.json({ error: "runId required" }, { status: 400 });
    }

    LOG("process batch start", { runId, batchSize });

    const { processed, hasMore } = await runVeilleProcessBatch(runId, batchSize);

    LOG("process batch result", { runId, processed, hasMore });

    if (hasMore) {
      const base = getBaseUrl(request);
      const nextUrl = `${base}/api/veille/process-batch`;
      const cookie = request.headers.get("cookie");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cookie) headers["Cookie"] = cookie;
      LOG("chain: triggering next batch", { nextUrl, runId, hasCookie: !!cookie });
      waitUntil(
        fetch(nextUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ runId, batchSize }),
        })
          .then((res) => {
            LOG("chain: next batch response", { status: res.status, ok: res.ok });
          })
          .catch((err) => {
            console.error("[veille/process-batch] chain error:", new Date().toISOString(), err);
          })
      );
    } else {
      LOG("chain: no more batches, run complete");
    }

    return NextResponse.json({ processed, hasMore });
  } catch (e) {
    LOG("error", e);
    console.error("[veille/process-batch] error:", new Date().toISOString(), e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Process batch failed" },
      { status: 500 }
    );
  }
}
