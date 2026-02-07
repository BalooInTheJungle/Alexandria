"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type MessageItem = {
  id: string;
  role: string;
  content: string;
  sources?: unknown;
  created_at: string;
};

const PAGE_SIZE = 20;

type Props = {
  conversationId: string | null;
  messageSentTrigger?: number;
};

export default function RagMessageList({ conversationId, messageSentTrigger = 0 }: Props) {
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    async (cursorParam?: string | null) => {
      if (!conversationId) {
        setMessages([]);
        setHasMore(false);
        return;
      }
      setLoading(true);
      try {
        const url = cursorParam
          ? `/api/rag/conversations/${conversationId}/messages?limit=${PAGE_SIZE}&cursor=${cursorParam}`
          : `/api/rag/conversations/${conversationId}/messages?limit=${PAGE_SIZE}`;
        const res = await fetch(url, { credentials: "include" });
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) return;
        const list = data as MessageItem[];
        if (cursorParam) {
          setMessages((prev) => [...prev, ...list]);
        } else {
          setMessages(list);
        }
        setHasMore(list.length === PAGE_SIZE);
        setCursor(list.length === PAGE_SIZE ? list[list.length - 1]?.id ?? null : null);
      } finally {
        setLoading(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    setMessages([]);
    setCursor(null);
    setHasMore(true);
    if (conversationId) loadPage(null);
  }, [conversationId, loadPage]);

  useEffect(() => {
    if (conversationId && messageSentTrigger > 0) loadPage(null);
  }, [messageSentTrigger, conversationId, loadPage]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore || loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor) loadPage(cursor);
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cursor, hasMore, loading, loadPage]);

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        Choisissez une conversation ou créez-en une nouvelle.
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      {messages.map((m) => (
        <Card
          key={m.id}
          className={cn(
            "max-w-[85%]",
            m.role === "user" ? "ml-auto bg-primary/10" : "mr-auto bg-muted"
          )}
        >
          <CardContent className="p-3">
            <div className="mb-1 text-xs text-muted-foreground">
              {m.role === "user" ? "Vous" : "Assistant"} — {new Date(m.created_at).toLocaleString("fr-FR")}
            </div>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{m.content}</pre>
          </CardContent>
        </Card>
      ))}
      {hasMore && (
        <div ref={loadMoreRef} className="py-2 text-center text-sm text-muted-foreground">
          {loading ? "Chargement…" : "—"}
        </div>
      )}
      {messages.length === 0 && !loading && (
        <p className="text-center text-sm text-muted-foreground">Aucun message. Envoyez une question.</p>
      )}
    </div>
  );
}
