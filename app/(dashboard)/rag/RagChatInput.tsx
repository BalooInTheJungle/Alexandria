"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type SourceItem = {
  index: number;
  title: string | null;
  doi: string | null;
  storage_path: string;
  excerpt: string;
};

type ChatResponse = {
  answer: string;
  sources: SourceItem[];
  conversationId?: string;
  messageId?: string;
};

type Props = {
  conversationId?: string | null;
  onConversationCreated?: (id: string) => void;
  onMessageSent?: () => void;
};

export default function RagChatInput({ conversationId: propConversationId = null, onConversationCreated, onMessageSent }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const conversationId = propConversationId ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const body: { query: string; stream?: boolean; conversationId?: string } = {
        query: q,
        stream: false,
      };
      if (conversationId) body.conversationId = conversationId;
      const res = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        console.error("[RAG] API error:", res.status, data);
        return;
      }
      setResponse(data as ChatResponse);
      if (data.conversationId) {
        onConversationCreated?.(data.conversationId);
      }
      onMessageSent?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      setError(msg);
      console.error("[RAG] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pose ta question sur le corpus…"
          disabled={loading}
          className="flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "…" : "Envoyer"}
        </Button>
      </form>
      {error && (
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </pre>
      )}
      {response && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <h3 className="text-sm font-semibold">Réponse</h3>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <pre className="whitespace-pre-wrap break-words text-sm">{response.answer}</pre>
            {response.sources && response.sources.length > 0 && (
              <>
                <h4 className="text-sm font-medium">Sources</h4>
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {response.sources.map((s) => (
                    <li key={s.index}>
                      [{s.index}] {s.title ?? "Sans titre"} — {s.excerpt.slice(0, 80)}…
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              conversationId: {response.conversationId} — messageId: {response.messageId}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
