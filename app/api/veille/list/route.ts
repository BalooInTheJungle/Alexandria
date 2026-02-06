import { NextResponse } from "next/server";

export async function GET() {
  // TODO: lister items rankés (sources depuis Supabase)
  return NextResponse.json({ items: [] });
}
