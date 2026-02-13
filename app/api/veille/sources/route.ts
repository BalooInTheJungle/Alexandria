import { NextResponse } from "next/server";
import { listSources, createSource } from "@/lib/db/sources";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] /api/veille/sources", msg, ...args);

/**
 * GET /api/veille/sources
 * Liste des sources (url, name, last_checked_at).
 */
export async function GET() {
  try {
    LOG("GET list");
    const sources = await listSources();
    LOG("GET ok", { count: sources.length });
    return NextResponse.json(sources);
  } catch (e) {
    LOG("GET error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List sources failed" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/veille/sources
 * Body: { url: string, name?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() || null : null;

    if (!url) {
      return NextResponse.json(
        { error: "Missing or empty 'url' in body" },
        { status: 400 }
      );
    }

    LOG("POST create", { url: url.slice(0, 50) });
    const source = await createSource({ url, name });
    LOG("POST ok", { id: source.id });
    return NextResponse.json(source);
  } catch (e) {
    LOG("POST error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create source failed" },
      { status: 500 }
    );
  }
}
