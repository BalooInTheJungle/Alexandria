import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] PATCH /api/veille/items/[id]", msg, ...args);

/**
 * PATCH /api/veille/items/[id]
 * Toggle read_at: sets to now if null, sets to null if already set.
 * Body: { read: boolean }
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  LOG("input", { id });
  try {
    const body = await request.json();
    const read: boolean = body.read === true;
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("veille_items")
      .update({ read_at: read ? new Date().toISOString() : null })
      .eq("id", id)
      .select("id, read_at")
      .single();

    if (error) {
      LOG("error", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    LOG("result", { id, read_at: data.read_at });
    return NextResponse.json(data);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
