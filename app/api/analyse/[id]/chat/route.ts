import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"
import { embedQuery } from "@/lib/rag/embed"
import type { MatchedChunk } from "@/lib/rag/search"

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/analyse/[id]/chat", msg, ...args)

const SYSTEM_PROMPT = `You are a research assistant helping to analyze a specific scientific document.
Rules:
- Answer ONLY based on the provided excerpts from the document and corpus sources.
- If the answer is not in the provided excerpts, say clearly: "Cette information ne figure pas dans le document."
- Cite your sources with references [1], [2], etc. corresponding to the excerpt numbers.
- Do not invent information. Do not use general knowledge outside the provided excerpts.
- Reply in the same language as the question.
- When asked about a figure or schema, describe what the surrounding text says about it.`

function getSanitizedOpenAIKey(): string {
  const raw = process.env.OPENAI_API_KEY ?? ""
  return raw.split(/\r?\n/)[0]?.replace(/^\s*Bearer\s+/i, "").replace(/[^\x20-\x7E]/g, "").trim() ?? ""
}

function buildContext(docChunks: MatchedChunk[], corpusChunks: MatchedChunk[]): string {
  const lines: string[] = []
  docChunks.forEach((c, i) => {
    lines.push(`[${i + 1}] (document analysé — section: ${c.section_title ?? "—"}, page: ${c.page ?? "?"})\n${c.content}`)
  })
  const offset = docChunks.length
  corpusChunks.forEach((c, i) => {
    lines.push(`[${offset + i + 1}] (corpus — ${c.doc_title ?? "sans titre"}, section: ${c.section_title ?? "—"})\n${c.content}`)
  })
  return lines.join("\n\n")
}

/**
 * POST /api/analyse/[id]/chat
 * Body: { query, history?: [{role, content}] }
 * Réponse: streaming SSE
 *
 * Recherche dans les chunks du document analysé en priorité,
 * puis complète avec le corpus si pertinent.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const query: string = typeof body?.query === "string" ? body.query.trim() : ""
  const history: { role: "user" | "assistant"; content: string }[] = Array.isArray(body?.history) ? body.history.slice(-6) : []

  if (!query) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 })
  }

  // Vérifier que l'analyse appartient à l'utilisateur
  const { data: analysis } = await supabase
    .from("document_analyses")
    .select("id, document_id, title")
    .eq("id", analysisId)
    .eq("user_id", user.id)
    .single()

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
  }

  LOG("start", { analysisId, query: query.slice(0, 60) })

  const embedding = await embedQuery(query)

  // 1. Chunks du document analysé (priorité)
  const { data: docChunksRaw } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_threshold: 0.3,
    match_count: 6,
  })

  const docChunks: MatchedChunk[] = ((docChunksRaw ?? []) as MatchedChunk[])
    .filter((c) => c.document_id === analysis.document_id)
    .slice(0, 5)

  // 2. Chunks corpus complémentaires (hors document analysé)
  const { data: corpusChunksRaw } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_threshold: 0.5,
    match_count: 4,
  })

  const corpusChunks: MatchedChunk[] = ((corpusChunksRaw ?? []) as MatchedChunk[])
    .filter((c) => c.document_id !== analysis.document_id)
    .slice(0, 3)

  LOG("chunks", { docChunks: docChunks.length, corpusChunks: corpusChunks.length })

  const allChunks = [...docChunks, ...corpusChunks]

  if (allChunks.length === 0) {
    return NextResponse.json({
      answer: "Je n'ai pas trouvé de passage pertinent dans le document pour répondre à cette question.",
      sources: [],
    })
  }

  // Sources pour l'UI
  const sources = allChunks.map((c, i) => ({
    index: i + 1,
    doc_title: c.doc_title,
    section_title: c.section_title,
    page: c.page,
    excerpt: c.content.slice(0, 400),
    similarity: Math.round(c.similarity * 1000) / 1000,
    is_document: c.document_id === analysis.document_id,
  }))

  const context = buildContext(docChunks, corpusChunks)
  const userContent = `Context (document excerpts):\n\n${context}\n\n---\n\nQuestion: ${query}`

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ]

  const apiKey = getSanitizedOpenAIKey()
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 })

  const client = new OpenAI({ apiKey })

  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    stream: true,
    temperature: 0.2,
    max_tokens: 1024,
  })

  // Streaming SSE — sources envoyées en premier event, puis tokens
  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      // Event sources envoyé en premier
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ sources })}\n\n`))

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`))
        }
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
