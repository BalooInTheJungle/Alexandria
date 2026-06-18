"use client"

import React, { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import dynamic from "next/dynamic"

const AnalysisPdfViewer = dynamic(() => import("./AnalysisPdfViewer"), { ssr: false })

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[AnalysisChatPanel]", msg, ...args)

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

export default function AnalysisChatPanel({ analysisId }: { analysisId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [warming, setWarming] = useState(true)
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    LOG("warmup start")
    fetch("/api/analyse/warmup")
      .then(() => { LOG("warmup done"); setWarming(false) })
      .catch(() => { LOG("warmup failed — allowing anyway"); setWarming(false) })
  }, [])

  async function sendMessage(query: string) {
    if (!query.trim() || loading) return
    LOG("sendMessage input:", { query: query.slice(0, 80), historyLength: messages.length })
    setInput("")

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
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Erreur") }

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
              // Auto-sélectionner la première source document pour le PDF
              const firstDocSrc = sources.find((s) => s.is_document) ?? sources[0]
              if (firstDocSrc) setSelectedSource(firstDocSrc)
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
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">

      {/* ── Gauche : PDF viewer ── */}
      <div className="lg:col-span-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Document
            {selectedSource?.page && (
              <span className="ml-2 font-normal normal-case">— page {selectedSource.page}</span>
            )}
          </p>
          <AnalysisPdfViewer
            analysisId={analysisId}
            page={selectedSource?.page ?? 1}
            highlight={selectedSource?.excerpt ?? null}
          />
        </div>
      </div>

      {/* ── Droite : Chat + sources ── */}
      <div className="lg:col-span-2 flex flex-col gap-3">

        {/* Messages */}
        <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 py-1">
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

          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {messages.map((msg, i) => (
              <div key={i}>
                {/* Bulle */}
                <div className={["flex", msg.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
                  <div className={[
                    "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  ].join(" ")}>
                    <p className="whitespace-pre-wrap">{msg.content || (loading && i === messages.length - 1 ? "…" : "")}</p>
                  </div>
                </div>

                {/* Sources sous le message assistant */}
                {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 space-y-1 pl-1">
                    {msg.sources.map((src) => (
                      <button
                        key={src.index}
                        onClick={() => setSelectedSource(src)}
                        className={[
                          "w-full text-left rounded px-2 py-1.5 text-xs transition-colors border",
                          selectedSource?.index === src.index && selectedSource?.excerpt === src.excerpt
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border hover:border-primary/50 hover:bg-muted/50 text-muted-foreground",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-bold text-primary">[{src.index}]</span>
                          <span className={[
                            "px-1 py-0.5 rounded text-[10px] font-medium",
                            src.is_document ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                          ].join(" ")}>
                            {src.is_document ? "Document" : "Corpus"}
                          </span>
                          {src.page && <span className="text-[10px]">p.{src.page}</span>}
                          <span className="ml-auto text-[10px]">{Math.max(0, Math.round(src.similarity * 100))}%</span>
                        </div>
                        <p className="line-clamp-2 text-[11px] leading-relaxed">{src.excerpt}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); sendMessage(input) }}
            className="flex gap-2 pt-1 border-t border-border mt-1"
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={warming ? "Initialisation du modèle…" : "Posez une question…"}
              disabled={loading || warming}
              className="flex-1 text-sm"
            />
            <Button type="submit" size="sm" disabled={loading || warming || !input.trim()}>
              {loading ? "…" : "Envoyer"}
            </Button>
          </form>
        </div>
      </div>

    </div>
  )
}
