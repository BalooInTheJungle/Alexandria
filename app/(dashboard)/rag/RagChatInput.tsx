"use client";

import { useState } from "react";

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

export default function RagChatInput() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

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
      if (data.conversationId) setConversationId(data.conversationId);
      console.log("[RAG] Response:", data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur réseau";
      setError(msg);
      console.error("[RAG] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pose ta question sur le corpus…"
          disabled={loading}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            fontSize: "1rem",
          }}
        />
        <button type="submit" disabled={loading} style={{ padding: "0.5rem 1rem" }}>
          {loading ? "…" : "Envoyer"}
        </button>
      </form>
      {conversationId && (
        <p style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.5rem" }}>
          Conversation : <code>{conversationId.slice(0, 8)}…</code>
        </p>
      )}
      {error && (
        <pre style={{ color: "crimson", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>{error}</pre>
      )}
      {response && (
        <div style={{ marginTop: "1rem", border: "1px solid #eee", padding: "1rem", borderRadius: 4 }}>
          <h3 style={{ marginTop: 0 }}>Réponse</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.9rem", margin: 0 }}>{response.answer}</pre>
          {response.sources?.length > 0 && (
            <>
              <h4 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Sources</h4>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.9rem" }}>
                {response.sources.map((s) => (
                  <li key={s.index}>
                    [{s.index}] {s.title ?? "Sans titre"} — {s.excerpt.slice(0, 80)}…
                  </li>
                ))}
              </ul>
            </>
          )}
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.5rem", marginBottom: 0 }}>
            conversationId: {response.conversationId} — messageId: {response.messageId}
          </p>
        </div>
      )}
    </div>
  );
}
