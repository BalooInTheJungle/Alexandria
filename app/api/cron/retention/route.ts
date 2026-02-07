import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const RETENTION_DAYS = 30;

/**
 * Vérifie que la requête est autorisée (clé secrète).
 * Accepte : Authorization: Bearer <CRON_SECRET> ou query ?secret=<CRON_SECRET>
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7) === secret) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

/**
 * GET /api/cron/retention
 * Supprime les conversations (et messages en cascade) où updated_at < now() - 30 jours.
 * Protégé par CRON_SECRET (env) : Authorization: Bearer <CRON_SECRET> ou ?secret=<CRON_SECRET>.
 * Réponse : { deleted: number } ou 401/500.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoff.toISOString();

    const { data: toDelete, error: selectError } = await supabase
      .from("conversations")
      .select("id")
      .lt("updated_at", cutoffIso);

    if (selectError) {
      console.error("[cron/retention] select error", selectError);
      return NextResponse.json(
        { error: "Failed to list conversations" },
        { status: 500 }
      );
    }

    const ids = (toDelete ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    const { error: deleteError } = await supabase
      .from("conversations")
      .delete()
      .lt("updated_at", cutoffIso);

    if (deleteError) {
      console.error("[cron/retention] delete error", deleteError);
      return NextResponse.json(
        { error: "Failed to delete conversations" },
        { status: 500 }
      );
    }

    return NextResponse.json({ deleted: ids.length });
  } catch (e) {
    console.error("[cron/retention] error", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
