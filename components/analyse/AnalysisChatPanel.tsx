"use client"

import React, { useState, useRef, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Source = {
  index: number
  doc_title: string | null
  section_title: string | null
  page: number | null
  excerpt: string
  similarity: number
  is_document: boolean
}

type Message = {
  role: "user" | "assistant"
  content: string
  sources?: Source[]
}

const SUGGESTIONS = [
  "Résume l'introduction",
  "Quelles sont les méthodes utilisées ?",
  "Quels sont les principaux résultats ?",
  "Quelles différences avec le corpus ?",
]

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[AnalysisChatPanel]", msg, ...args)

export default function AnalysisChatPanel({ analysisId }: { analysisId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [activeSources, setActiveSources] = useState<Source[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function sendMessage(query: string) {
    if (!query.trim() || loading) return
    LOG("sendMessage input:", { query: query.slice(0, 80), historyLength: messages.length })
    setInput("")
    setActiveSources(null)

    const userMsg: Message = { role: "user", content: query }
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const assistantMsg: Message = { role: "assistant", content: "" }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      LOG("fetch start:", { analysisId })
      const res = await fetch(`/api/analyse/${analysisId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, history }),
      })

      LOG("fetch response:", { status: res.status, ok: res.ok })

      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur")
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let sources: Source[] = []
      let tokenCount = 0

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (raw === "[DONE]") {
            LOG("stream done:", { sourcesReceived: sources.length, tokenCount })
            break
          }
          try {
            const parsed = JSON.parse(raw)
            if (parsed.sources) {
              sources = parsed.sources
              LOG("sources received:", sources.map((s) => ({ index: s.index, is_document: s.is_document, similarity: s.similarity })))
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = { ...next[next.length - 1], sources }
                return next
              })
              setActiveSources(sources)
            }
            if (parsed.token) {
              tokenCount++
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = {
                  ...next[next.length - 1],
                  content: next[next.length - 1].content + parsed.token,
                }
                return next
              })
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      LOG("error:", err)
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: err instanceof Error ? err.message : "Erreur inattendue",
        }
        return next
      })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

      {/* Chat principal */}
      <div className="lg:col-span-3 flex flex-col gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Discussion sur le document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">

            {/* Suggestions si vide */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 py-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary hover:text-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {messages.map((msg, i) => (
                <div key={i} className={["flex", msg.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
                  <div className={[
                    "max-w-[85%] rounded-lg px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  ].join(" ")}>
                    <p className="whitespace-pre-wrap">{msg.content || (loading && i === messages.length - 1 ? "…" : "")}</p>
                    {/* Bouton voir sources */}
                    {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                      <button
                        onClick={() => setActiveSources(msg.sources ?? null)}
                        className="mt-2 text-xs text-muted-foreground hover:text-primary underline underline-offset-2"
                      >
                        {msg.sources.length} source{msg.sources.length > 1 ? "s" : ""} →
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input) }}
              className="flex gap-2 pt-1"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Posez une question sur ce document…"
                disabled={loading}
                className="flex-1 text-sm"
              />
              <Button type="submit" size="sm" disabled={loading || !input.trim()}>
                {loading ? "…" : "Envoyer"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Panel sources */}
      <div className="lg:col-span-2">
        <Card className="sticky top-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Sources utilisées
              {activeSources && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {activeSources.length} passage{activeSources.length > 1 ? "s" : ""}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!activeSources ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Les passages utilisés apparaîtront ici après chaque réponse.
              </p>
            ) : (
              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                {activeSources.map((src) => (
                  <div key={src.index} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-primary">[{src.index}]</span>
                      <span className={[
                        "text-xs px-1.5 py-0.5 rounded font-medium",
                        src.is_document
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}>
                        {src.is_document ? "Document" : "Corpus"}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {Math.round(src.similarity * 100)}%
                      </span>
                    </div>
                    <p className="text-xs font-medium truncate">{src.doc_title ?? "Document analysé"}</p>
                    {(src.section_title || src.page) && (
                      <p className="text-xs text-muted-foreground">
                        {src.section_title && <span>{src.section_title}</span>}
                        {src.section_title && src.page && " · "}
                        {src.page && <span>Page {src.page}</span>}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 border-l-2 border-primary/20 pl-2">
                      {src.excerpt}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
