"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  conversationId?: string | null;
  onSending?: (query: string) => void;
  onStreamChunk?: (delta: string) => void;
  onStreamDone?: () => void;
  onConversationCreated?: (id: string) => void;
  onMessageSent?: () => void;
};

export default function RagChatInput({
  conversationId: propConversationId = null,
  onSending,
  onStreamChunk,
  onStreamDone,
  onConversationCreated,
  onMessageSent,
}: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = propConversationId ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setError(null);
    setQuery("");
    setLoading(true);
    onSending?.(q);

    try {
      const body: { query: string; stream?: boolean; conversationId?: string } = {
        query: q,
        stream: true,
      };
      if (conversationId) body.conversationId = conversationId;

      const res = await fetch("/api/rag/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Erreur ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("Pas de stream");

      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.text) onStreamChunk?.(json.text);
            if (json.done) {
              if (json.conversationId) onConversationCreated?.(json.conversationId);
              onStreamDone?.();
              onMessageSent?.();
            }
            if (json.error) throw new Error(json.error);
          } catch (err) {
            if (err instanceof SyntaxError) continue;
            throw err;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      setError(msg);
      onStreamDone?.();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex w-full gap-2">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pose ta question sur le corpus…"
          disabled={loading}
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={loading}>
          {loading ? "…" : "Envoyer"}
        </Button>
      </form>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
