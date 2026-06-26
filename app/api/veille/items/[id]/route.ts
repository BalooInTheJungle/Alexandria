import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] PATCH /api/veille/items/[id]", msg, ...args);

/**
 * PATCH /api/veille/items/[id]
 * Body: { read: boolean } — toggle read_at
 *    or { relevant: boolean | null } — set is_relevant feedback
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { id } = params;
  LOG("input", { id });
  try {
    const body = await request.json();
    const supabase = createAdminClient();

    if ("relevant" in body) {
      const is_relevant: boolean | null = body.relevant ?? null;
      LOG("body relevant", { is_relevant });
      const { data, error } = await supabase
        .from("veille_items")
        .update({ is_relevant })
        .eq("id", id)
        .select("id, is_relevant")
        .single();
      if (error) {
        LOG("update error", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      LOG("relevant updated", { id, is_relevant: data.is_relevant });
      return NextResponse.json(data);
    }

    const read: boolean = body.read === true;
    const read_at_value = read ? new Date().toISOString() : null;
    LOG("body read", { read, read_at_value });
    const { data, error } = await supabase
      .from("veille_items")
      .update({ read_at: read_at_value })
      .eq("id", id)
      .select("id, read_at")
      .single();
    if (error) {
      LOG("update error", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    LOG("read updated", { id, read_at: data.read_at });
    return NextResponse.json(data);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
