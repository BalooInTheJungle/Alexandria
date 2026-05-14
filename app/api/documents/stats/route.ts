import { NextResponse } from "next/server";
import { getDocumentStats } from "@/lib/db/documents";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[API] GET /api/documents/stats input:", {});
  try {
    const stats = await getDocumentStats();
    console.log("[API] GET /api/documents/stats result:", {
      docs: stats.docs,
      chunks: stats.chunks,
      topTermsCount: stats.topTerms.length,
    });
    return NextResponse.json(stats);
  } catch (e) {
    console.error("[API] GET /api/documents/stats error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stats failed" },
      { status: 500 }
    );
  }
}
