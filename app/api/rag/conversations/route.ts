import { NextResponse } from "next/server";
import { listConversations } from "@/lib/rag/conversation-persistence";

/**
 * GET /api/rag/conversations
 * Liste des conversations (ordre updated_at desc).
 * Query: ?limit=50 (optionnel, défaut 50, max 100).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

    const conversations = await listConversations(limit);
    return NextResponse.json(conversations);
  } catch (e) {
    console.error("[RAG/conversations] GET error", e);
    return NextResponse.json(
      { error: "Failed to list conversations" },
      { status: 500 }
    );
  }
}
