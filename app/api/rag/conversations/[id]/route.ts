import { NextResponse } from "next/server";
import {
  updateConversationTitle,
  deleteConversation,
} from "@/lib/rag/conversation-persistence";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/rag/conversations/[id]
 * Modifier le titre. Body : { "title": "Nouveau titre" }.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    }

    const body = await request.json();
    const title =
      typeof body?.title === "string" ? body.title.trim() : undefined;
    if (title === undefined) {
      return NextResponse.json(
        { error: "Body must include { \"title\": \"...\" }" },
        { status: 400 }
      );
    }

    const result = await updateConversationTitle(id, title);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[API] PATCH /api/rag/conversations/[id]", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/rag/conversations/[id]
 * Supprime la conversation (messages en cascade).
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    }

    const result = await deleteConversation(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[API] DELETE /api/rag/conversations/[id]", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
