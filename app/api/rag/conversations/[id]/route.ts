import { NextResponse } from "next/server";
import { updateConversationTitle, deleteConversation } from "@/lib/rag/conversation-persistence";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/rag/conversations/[id]
 * Body: { "title": "Nouveau titre" }
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title : undefined;
    if (title === undefined) {
      return NextResponse.json(
        { error: "Body must include 'title' (string)" },
        { status: 400 }
      );
    }

    const updated = await updateConversationTitle(id, title);
    if (!updated) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    const safeTitle = (title ?? "").trim().slice(0, 255) || "Nouvelle conversation";
    return NextResponse.json({ id, title: safeTitle });
  } catch (e) {
    console.error("[RAG/conversations/[id]] PATCH error", e);
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rag/conversations/[id]
 * Supprime la conversation (messages en cascade).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    }

    const deleted = await deleteConversation(id);
    if (!deleted) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[RAG/conversations/[id]] DELETE error", e);
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
