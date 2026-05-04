"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  conversationId?: string | null;
  onConversationCreated?: (id: string) => void;
  onMessageSent?: () => void;
};

export default function RagChatInput({ conversationId: propConversationId = null, onConversationCreated, onMessageSent }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = propConversationId ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setError(null);
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
        console.error("[RagChatInput] API error:", res.status, data);
        return;
      }
      setQuery("");
      if (data.conversationId) {
        onConversationCreated?.(data.conversationId);
      }
      onMessageSent?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      setError(msg);
      console.error("[RagChatInput] Fetch error:", err);
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
    </div>
  );
}
