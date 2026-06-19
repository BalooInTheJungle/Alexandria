"use client"

import React, { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
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
  isComplete?: boolean
}

const SUGGESTIONS = [
  "Résume l'introduction",
  "Quelles sont les méthodes utilisées ?",
  "Quels sont les principaux résultats ?",
  "Quelles différences avec le corpus ?",
]

function renderInline(
  text: string,
  sources: Source[],
  selectedSource: Source | null,
  onSelect: (s: Source) => void
): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g)
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    }
    const citMatch = part.match(/^\[(\d+)\]$/)
    if (citMatch) {
      const idx = parseInt(citMatch[1]) - 1
      const src = sources[idx]
      if (src) {
        const isSelected = selectedSource?.index === src.index && selectedSource?.excerpt === src.excerpt
        return (
          <button
            key={i}
            onClick={() => onSelect(src)}
            title={src.excerpt?.slice(0, 100)}
            className={[
              "inline-flex items-center justify-center text-[10px] font-bold rounded px-1 py-0.5 mx-0.5 transition-colors border align-middle",
              isSelected
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20",
            ].join(" ")}
          >
            {citMatch[1]}
          </button>
        )
      }
    }
    return <span key={i}>{part}</span>
  })
}

function renderMarkdown(
  content: string,
  sources: Source[],
  selectedSource: Source | null,
  onSelect: (s: Source) => void
) {
  const lines = content.split("\n")
  const nodes: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith("# ")) {
      nodes.push(
        <h2 key={i} className="text-sm font-bold mt-3 mb-1">
          {renderInline(line.slice(2), sources, selectedSource, onSelect)}
        </h2>
      )
    } else if (line.startsWith("## ")) {
      nodes.push(
        <h3 key={i} className="text-xs font-bold mt-2 mb-0.5 uppercase tracking-wide text-muted-foreground">
          {renderInline(line.slice(3), sources, selectedSource, onSelect)}
        </h3>
      )
    } else if (line.startsWith("- ")) {
      nodes.push(
        <div key={i} className="flex gap-1.5 mb-0.5 ml-1">
          <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
          <span>{renderInline(line.slice(2), sources, selectedSource, onSelect)}</span>
        </div>
      )
    } else if (line.match(/^\d+\.\s/)) {
      nodes.push(
        <p key={i} className="mb-0.5 ml-1">
          {renderInline(line, sources, selectedSource, onSelect)}
        </p>
      )
    } else if (line.trim() === "") {
      nodes.push(<div key={i} className="h-2" />)
    } else {
      nodes.push(
        <p key={i} className="mb-0.5">
          {renderInline(line, sources, selectedSource, onSelect)}
        </p>
      )
    }
  }

  return <div className="text-sm leading-relaxed space-y-0">{nodes}</div>
}

export default function AnalysisChatPanel({ analysisId, title }: { analysisId: string; title?: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [warming, setWarming] = useState(true)
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [expandedSources, setExpandedSources] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    LOG("warmup + suggestions start")
    fetch("/api/analyse/warmup")
      .then(() => { LOG("warmup done"); setWarming(false) })
      .catch(() => { LOG("warmup failed — allowing anyway"); setWarming(false) })
    fetch(`/api/analyse/${analysisId}/suggestions`)
      .then((r) => r.json())
      .then((d) => { if (d.suggestions?.length) { LOG("suggestions loaded", d.suggestions); setSuggestions(d.suggestions) } })
      .catch(() => {})
  }, [analysisId])

  async function sendMessage(query: string) {
    if (!query.trim() || loading) return
    LOG("sendMessage input:", { query: query.slice(0, 80), historyLength: messages.length })
    setInput("")

    const userMsg: Message = { role: "user", content: query }
    const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const assistantMsg: Message = { role: "assistant", content: "", isComplete: false }
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
            // Marquer le message comme complet → active les citations cliquables
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = { ...next[next.length - 1], isComplete: true }
              return next
            })
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
          isComplete: true,
        }
        return next
      })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-full">

        {/* ── Gauche : PDF viewer ── */}
        <div className="lg:col-span-3 h-full flex flex-col">
          <div className="rounded-lg border border-border bg-card p-3 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Document
                {selectedSource?.page && (
                  <span className="ml-2 font-normal normal-case">— page {selectedSource.page}</span>
                )}
              </p>
              <button
                onClick={() => setPdfOpen(true)}
                title="Plein écran"
                className="text-xs text-muted-foreground hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-border hover:border-primary"
              >
                ⛶ Plein écran
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <AnalysisPdfViewer
                analysisId={analysisId}
                page={selectedSource?.page ?? 1}
                highlight={selectedSource?.excerpt ?? null}
              />
            </div>
          </div>
        </div>

        {/* ── Droite : Chat ── */}
        <div className="lg:col-span-2 h-full flex flex-col">
          <div className="rounded-lg border border-border bg-card p-3 h-full flex flex-col gap-3">

            {/* Zone messages — état vide ou historique */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col">
              {messages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-2xl">📄</p>
                    <p className="text-sm font-semibold text-foreground">
                      {title ? title : "Document chargé"}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Interrogez ce document et comparez-le à votre corpus.<br />
                      Les réponses citent les passages sources.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col justify-end flex-1 space-y-4 py-1">
                  {messages.map((msg, i) => (
                    <div key={i}>
                      <div className={["flex", msg.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
                        <div className={[
                          "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground",
                        ].join(" ")}>
                          {msg.role === "assistant" && msg.isComplete && msg.sources?.length ? (
                            renderMarkdown(msg.content, msg.sources, selectedSource, setSelectedSource)
                          ) : (
                            <p className="whitespace-pre-wrap text-sm leading-relaxed">
                              {msg.content || (loading && i === messages.length - 1 ? "…" : "")}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Dropdown sources sous chaque réponse assistant complète */}
                      {msg.role === "assistant" && msg.isComplete && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-1.5 ml-1">
                          <button
                            onClick={() => setExpandedSources(expandedSources === i ? null : i)}
                            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <span>{expandedSources === i ? "▾" : "▸"}</span>
                            <span>
                              {msg.sources.filter(s => s.is_document).length} source{msg.sources.filter(s => s.is_document).length > 1 ? "s" : ""} dans le document
                              {msg.sources.filter(s => !s.is_document).length > 0 && ` · ${msg.sources.filter(s => !s.is_document).length} corpus`}
                            </span>
                          </button>

                          {expandedSources === i && (
                            <div className="mt-2 flex flex-col gap-2">
                              {/* Sources document en premier */}
                              {msg.sources.filter(s => s.is_document).map((src) => (
                                <button
                                  key={`doc-${src.index}`}
                                  onClick={() => setSelectedSource(src)}
                                  className={[
                                    "text-left rounded-lg border p-2.5 text-xs transition-colors w-full",
                                    selectedSource?.index === src.index && selectedSource?.excerpt === src.excerpt
                                      ? "border-primary bg-primary/5"
                                      : "border-border hover:border-primary/50 hover:bg-muted/40",
                                  ].join(" ")}
                                >
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className="font-bold text-primary">[{src.index}]</span>
                                    <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-medium">Document</span>
                                    {src.page && (
                                      <span className="text-muted-foreground text-[10px]">Page {src.page}</span>
                                    )}
                                    {src.section_title && (
                                      <span className="text-muted-foreground text-[10px] truncate">· {src.section_title}</span>
                                    )}
                                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                                      {Math.max(0, Math.round(src.similarity * 100))}%
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground leading-relaxed line-clamp-4">{src.excerpt}</p>
                                </button>
                              ))}

                              {/* Sources corpus ensuite */}
                              {msg.sources.filter(s => !s.is_document).map((src) => (
                                <div
                                  key={`corpus-${src.index}`}
                                  className="text-left rounded-lg border border-border bg-muted/20 p-2.5 text-xs"
                                >
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <span className="font-bold text-muted-foreground">[{src.index}]</span>
                                    <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded text-[10px] font-medium">Corpus</span>
                                    {src.doc_title && (
                                      <span className="text-muted-foreground text-[10px] truncate">· {src.doc_title}</span>
                                    )}
                                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                                      {Math.max(0, Math.round(src.similarity * 100))}%
                                    </span>
                                  </div>
                                  <p className="text-muted-foreground leading-relaxed line-clamp-4">{src.excerpt}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            {/* Suggestions dynamiques au-dessus de l'input */}
            {suggestions.length > 0 && messages.length === 0 && (
              <div className="flex flex-col gap-1.5 shrink-0">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={loading || warming}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors disabled:opacity-40 leading-snug"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input) }}
              className="flex gap-2 pt-1 border-t border-border shrink-0"
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

      {/* ── Modal PDF plein écran ── */}
      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent className="!max-w-[96vw] w-[96vw] h-[94vh] flex flex-col p-3 gap-2">
          <p className="text-xs font-semibold text-muted-foreground shrink-0">
            Document{selectedSource?.page ? ` — page ${selectedSource.page}` : ""}
          </p>
          <div className="flex-1 min-h-0 overflow-auto">
            <AnalysisPdfViewer
              analysisId={analysisId}
              page={selectedSource?.page ?? 1}
              highlight={selectedSource?.excerpt ?? null}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
