import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/veille/runs/[id]/stop", msg, ...args);

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/veille/runs/[id]/stop
 * Demande l'arrêt d'une run en cours (abort_requested = true).
 * La pipeline vérifie ce flag avant chaque item et met status = stopped si demandé.
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
      .update({ abort_requested: true })
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
