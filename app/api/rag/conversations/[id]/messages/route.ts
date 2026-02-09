import { NextResponse } from "next/server";
import { getMessages } from "@/lib/rag/conversation-persistence";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/rag/conversations/[id]/messages
 * Messages de la conversation, pagination par cursor.
 * Query : ?cursor=message_id&limit=20 (ordre created_at asc).
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id: conversationId } = await params;
    if (!conversationId) {
      return NextResponse.json(
        { error: "Missing conversation id" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const limit = Math.min(
      Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20),
      100
    );

    const messages = await getMessages(conversationId, { cursor, limit });
    return NextResponse.json(messages);
  } catch (e) {
    console.error("[API] GET /api/rag/conversations/[id]/messages", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
