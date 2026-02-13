import { NextResponse } from "next/server";
import { updateSource, deleteSource, getSourceById } from "@/lib/db/sources";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] /api/veille/sources/[id]", msg, ...args);

type Params = { params: Promise<{ id: string }> };

const FETCH_STRATEGIES = ["auto", "fetch", "rss"] as const;

/**
 * PATCH /api/veille/sources/[id]
 * Body: { url?: string, name?: string, fetch_strategy?: 'auto'|'fetch'|'rss' }
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const existing = await getSourceById(id);
    if (!existing) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const updates: { url?: string; name?: string | null; fetch_strategy?: typeof FETCH_STRATEGIES[number] } = {};
    if (typeof body?.url === "string") updates.url = body.url.trim();
    if (typeof body?.name === "string") updates.name = body.name.trim() || null;
    if (FETCH_STRATEGIES.includes(body?.fetch_strategy)) updates.fetch_strategy = body.fetch_strategy;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(existing);
    }

    const source = await updateSource(id, updates);
    return NextResponse.json(source);
  } catch (e) {
    LOG("PATCH error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update source failed" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/veille/sources/[id]
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const existing = await getSourceById(id);
    if (!existing) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    await deleteSource(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    LOG("DELETE error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete source failed" },
      { status: 500 }
    );
  }
}
