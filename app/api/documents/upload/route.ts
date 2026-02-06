import { NextResponse } from "next/server";

export async function POST(request: Request) {
  // TODO: upload PDF → Storage + création document (section Bibliographie)
  return NextResponse.json({ ok: true });
}
