import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/veille/runs/[id]/stop", msg, ...args);

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/veille/runs/[id]/stop
 * Arrête immédiatement la run (status = stopped).
 * Si process-batch tourne encore, il vérifiera abort_requested et s'arrêtera proprement.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    LOG("POST", { id });

    const supabase = createAdminClient();
    const { data: run, error: fetchErr } = await supabase
      .from("veille_runs")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr || !run) {
      LOG("not found", { id });
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status !== "running") {
      return NextResponse.json(
        { error: `Run is not running (status: ${run.status})` },
        { status: 400 }
      );
    }

    const { error: updateErr } = await supabase
      .from("veille_runs")
      .update({
        abort_requested: true,
        status: "stopped",
        completed_at: new Date().toISOString(),
        error_message: "Arrêt demandé par l'utilisateur",
        phase: "done",
      })
      .eq("id", id);

    if (updateErr) {
      LOG("update error", updateErr.message);
      return NextResponse.json(
        { error: "Failed to request stop" },
        { status: 500 }
      );
    }

    LOG("ok", { id });
    return NextResponse.json({ ok: true, message: "Arrêt demandé" });
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stop failed" },
      { status: 500 }
    );
  }
}
