import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // TODO: déclencher pipeline veille (job asynchrone, toutes les sources d'un coup)
  return NextResponse.json({ ok: true });
}
