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
    const read_at_value = read ? new Date().toISOString() : null;
    LOG("body", { read, read_at_value });
    const supabase = createAdminClient();

    // First verify the item exists
    const { data: existing, error: fetchError } = await supabase
      .from("veille_items")
      .select("id, read_at")
      .eq("id", id)
      .single();
    LOG("existing row", { existing, fetchError: fetchError?.message });

    const { data, error } = await supabase
      .from("veille_items")
      .update({ read_at: read_at_value })
      .eq("id", id)
      .select("id, read_at")
      .single();

    if (error) {
      LOG("update error", { message: error.message, code: error.code, details: error.details });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    LOG("update result", { id, read_at_before: existing?.read_at, read_at_after: data.read_at });
    return NextResponse.json(data);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
