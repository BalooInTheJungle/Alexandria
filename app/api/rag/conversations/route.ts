import { NextResponse } from "next/server";
import { listConversations } from "@/lib/rag/conversation-persistence";

/**
 * GET /api/rag/conversations
 * Liste des conversations : { id, title, created_at, updated_at }[], ordre updated_at desc.
 * Query : ?limit=50 (défaut 50, max 100).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50),
      100
    );

    const list = await listConversations(limit);
    return NextResponse.json(list);
  } catch (e) {
    console.error("[API] GET /api/rag/conversations", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
