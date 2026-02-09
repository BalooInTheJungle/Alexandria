"use client";

import { useState } from "react";
import Link from "next/link";
import RagConversationSidebar from "@/components/rag/RagConversationSidebar";
import RagMessageList from "@/components/rag/RagMessageList";
import RagChatInput from "./RagChatInput";
import { Button } from "@/components/ui/button";

export default function RagPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [messageSentTrigger, setMessageSentTrigger] = useState(0);

  return (
    <div className="flex h-[calc(100vh-60px)] overflow-hidden">
      <RagConversationSidebar
        selectedId={selectedId}
        onSelect={setSelectedId}
        refreshTrigger={refreshTrigger}
      />
      <div className="flex flex-1 flex-col min-w-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h1 className="text-lg font-semibold">Recherche RAG</h1>
          <Button variant="outline" size="sm" asChild>
            <Link href="/rag/settings">Paramètres RAG</Link>
          </Button>
        </div>
        <RagMessageList
          conversationId={selectedId}
          messageSentTrigger={messageSentTrigger}
        />
        <div className="border-t border-border p-4">
          <RagChatInput
            conversationId={selectedId}
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
