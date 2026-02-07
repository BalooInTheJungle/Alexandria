import { NextResponse } from "next/server";
import { getMessagesPaginated } from "@/lib/rag/conversation-persistence";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/rag/conversations/[id]/messages
 * Messages de la conversation (ordre created_at asc), pagination cursor.
 * Query: ?cursor=message_id&limit=20 (cursor = id du dernier message de la page précédente).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: conversationId } = await params;
    if (!conversationId) {
      return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10) || 20)) : 20;

    const messages = await getMessagesPaginated(conversationId, { cursor, limit });
    return NextResponse.json(messages);
  } catch (e) {
    console.error("[RAG/conversations/[id]/messages] GET error", e);
    return NextResponse.json(
      { error: "Failed to get messages" },
      { status: 500 }
    );
  }
}
