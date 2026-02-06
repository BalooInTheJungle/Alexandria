import { NextResponse } from "next/server";
import { searchChunks } from "@/lib/rag/search";
import { createRagAnswerStream } from "@/lib/rag/openai";
import { chunksToSources } from "@/lib/rag/citations";
import { getRagSettings } from "@/lib/rag/settings";
import {
  getOrCreateConversation,
  insertMessage,
  getLastMessages,
  type MessageRow,
} from "@/lib/rag/conversation-persistence";
import type { SourceForDisplay } from "@/lib/rag/citations";

export type ChatResponse = {
  answer: string;
  sources: SourceForDisplay[];
  conversationId?: string;
  messageId?: string;
};

function messagesToHistory(rows: MessageRow[]): { role: "user" | "assistant"; content: string }[] {
  return rows.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}

const LOG = (msg: string, ...args: unknown[]) => console.log("[RAG/chat]", msg, ...args);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    const useStream = body?.stream !== false;

    LOG("POST body", { query: query?.slice(0, 50), conversationId, stream: useStream });

    if (!query) {
      LOG("Reject: empty query");
      return NextResponse.json(
        { error: "Missing or empty 'query' in body" },
        { status: 400 }
      );
    }

    const settings = await getRagSettings();
    LOG("Settings", { context_turns: settings.context_turns, similarity_threshold: settings.similarity_threshold, match_count: settings.match_count });

    const { chunks, bestVectorSimilarity } = await searchChunks(query, {
      matchThreshold: 0.01,
      matchCount: settings.match_count,
      settings,
    });

    const isOutOfDomain =
      chunks.length === 0 || bestVectorSimilarity < settings.similarity_threshold;

    LOG("Search result", { chunksCount: chunks.length, bestVectorSimilarity, isOutOfDomain });

    const conversationTitle = query.slice(0, 50) + (query.length > 50 ? "…" : "");
    const { id: convId } = await getOrCreateConversation(conversationId, conversationTitle);
    LOG("Conversation", { convId, existing: !!conversationId });

    const { id: userMsgId } = await insertMessage(convId, "user", query);
    LOG("User message inserted", { userMsgId });

    if (isOutOfDomain) {
      const guardMessage = settings.guard_message;
      const { id: msgId } = await insertMessage(convId, "assistant", guardMessage);
      LOG("Guard: out of domain", { msgId });
      return NextResponse.json<ChatResponse>({
        answer: guardMessage,
        sources: [],
        conversationId: convId,
        messageId: msgId,
      });
    }

    const sources = chunksToSources(chunks);

    const lastRows = await getLastMessages(convId, 2 * settings.context_turns + 1);
    const historyRows = lastRows
      .filter((m) => m.id !== userMsgId)
      .reverse()
      .slice(0, 2 * settings.context_turns);
    const history = messagesToHistory(historyRows);
    LOG("History for LLM", { historyMessagesCount: history.length });

    if (!useStream) {
      const { generateRagAnswer } = await import("@/lib/rag/openai");
      LOG("Calling OpenAI (non-stream)");
      const answer = await generateRagAnswer(query, chunks, history);
      const { id: msgId } = await insertMessage(convId, "assistant", answer, sources);
      LOG("Assistant message inserted", { msgId, answerLength: answer.length });
      return NextResponse.json<ChatResponse>({
        answer,
        sources,
        conversationId: convId,
        messageId: msgId,
      });
    }

    LOG("Calling OpenAI (stream)");
    const stream = await createRagAnswerStream(query, chunks, history);

    const encoder = new TextEncoder();
    let fullContent = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content ?? "";
            if (delta) {
              fullContent += delta;
              controller.enqueue(
                encoder.encode("data: " + JSON.stringify({ text: delta }) + "\n\n")
              );
            }
          }

          const { id: msgId } = await insertMessage(convId, "assistant", fullContent, sources);
          LOG("Stream done, assistant message inserted", { msgId, fullContentLength: fullContent.length });
          controller.enqueue(
            encoder.encode(
              "data: " +
                JSON.stringify({
                  done: true,
                  conversationId: convId,
                  messageId: msgId,
                  sources,
                }) +
                "\n\n"
            )
          );
        } catch (err) {
          LOG("Stream error", err);
          controller.enqueue(
            encoder.encode(
              "data: " +
                JSON.stringify({
                  error: err instanceof Error ? err.message : "Stream failed",
                }) +
                "\n\n"
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "RAG chat failed";
    console.error("[RAG/chat] Error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
