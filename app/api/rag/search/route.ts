import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // TODO: recherche hybride FTS + vector + fusion (RRF) + rerank + context
  return NextResponse.json({ ok: true });
}
