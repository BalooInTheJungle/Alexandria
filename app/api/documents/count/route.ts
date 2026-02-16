import { NextResponse } from "next/server";
import { countDocuments } from "@/lib/db/documents";

/**
 * GET /api/documents/count
 * Retourne le nombre de documents en base (pour la page Database).
 */
export async function GET() {
  try {
    const count = await countDocuments();
    return NextResponse.json({ count });
  } catch (e) {
    console.error("[API] GET /api/documents/count", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Count failed" },
      { status: 500 }
    );
  }
}
