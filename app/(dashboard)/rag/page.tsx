"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import RagConversationSidebar from "@/components/rag/RagConversationSidebar";
import RagMessageList from "@/components/rag/RagMessageList";
import RagChatInput from "./RagChatInput";
import { Button } from "@/components/ui/button";

export default function RagPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [messageSentTrigger, setMessageSentTrigger] = useState(0);
  const [tailUserMessage, setTailUserMessage] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState<string>("");

  const handleStreamDone = useCallback(() => {
    setTailUserMessage(null);
    setStreamingContent("");
    setMessageSentTrigger((t) => t + 1);
  }, []);

  return (
    <div className="flex h-[calc(100vh-60px)] overflow-hidden">
      <RagConversationSidebar
        selectedId={selectedId}
        onSelect={setSelectedId}
        refreshTrigger={refreshTrigger}
      />
      <div className="flex flex-1 flex-col min-w-0">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold">Chatbot</h1>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                Posez vos questions sur le corpus de publications indexées. L'assistant recherche les passages les plus pertinents et génère une réponse avec les sources citées.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild className="shrink-0 mt-1">
              <Link href="/rag/settings">Paramètres</Link>
            </Button>
          </div>
        </div>
        <RagMessageList
          conversationId={selectedId}
          messageSentTrigger={messageSentTrigger}
          tailUserMessage={tailUserMessage}
          streamingContent={streamingContent}
        />
        <div className="border-t border-border p-4">
          <RagChatInput
            conversationId={selectedId}
            onSending={(query) => {
              setTailUserMessage(query);
              setStreamingContent("");
            }}
            onStreamChunk={(delta) => setStreamingContent((prev) => prev + delta)}
            onStreamDone={handleStreamDone}
            onConversationCreated={(id) => {
              setSelectedId(id);
              setRefreshTrigger((t) => t + 1);
            }}
            onMessageSent={() => setMessageSentTrigger((t) => t + 1)}
          />
        </div>
      </div>
    </div>
  );
}
