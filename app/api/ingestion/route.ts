import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // TODO: post-upload — parse, chunk, embed — à détailler plus tard
  return NextResponse.json({ ok: true });
}
