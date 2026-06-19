import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import OpenAI from "openai"

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/analyse/[id]/suggestions", msg, ...args)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: analysis } = await supabase
    .from("document_analyses")
    .select("id, title, document_id, summary")
    .eq("id", analysisId)
    .eq("user_id", user.id)
    .single()

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
  }

  LOG("generating suggestions", { title: analysis.title, hasSummary: !!analysis.summary, documentId: analysis.document_id })

  const summary = analysis.summary as {
    tldr?: string; methods?: string; results?: string
  } | null

  let context = `Titre : ${analysis.title ?? "Document scientifique"}`

  if (summary?.tldr || summary?.methods || summary?.results) {
    // Résumé déjà calculé — on s'en sert
    if (summary.tldr) context += `\nRésumé : ${summary.tldr}`
    if (summary.methods) context += `\nMéthodes : ${summary.methods}`
    if (summary.results) context += `\nRésultats : ${summary.results}`
  } else if (analysis.document_id) {
    // Pas de résumé — on prend les premiers chunks du document
    const { data: chunks } = await supabase
      .from("chunks")
      .select("content, position")
      .eq("document_id", analysis.document_id)
      .order("position")
      .limit(6)

    if (chunks && chunks.length > 0) {
      const extract = chunks.map((c) => c.content).join(" ").slice(0, 1500)
      context += `\nExtrait du document :\n${extract}`
      LOG("using chunks as context", { chunkCount: chunks.length, extractLength: extract.length })
    }
  }

  LOG("context built", { contextLength: context.length })

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: `Tu es un assistant de recherche pour un chercheur CNRS en chimie et matériaux moléculaires magnétiques.
À partir du contenu du document fourni, génère exactement 4 questions de recherche pertinentes que le chercheur pourrait poser.
Les questions doivent être précises, contextualisées au contenu, et porter sur les méthodes, résultats, mécanismes, ou comparaisons avec d'autres travaux.
Réponds UNIQUEMENT avec un tableau JSON de 4 strings en français, sans aucune explication autour.
Format exact attendu : ["Question 1 ?", "Question 2 ?", "Question 3 ?", "Question 4 ?"]`,
        },
        {
          role: "user",
          content: context,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]"
    LOG("raw response", { raw })

    const match = raw.match(/\[[\s\S]*?\]/)
    const suggestions: string[] = match ? JSON.parse(match[0]) : []

    LOG("suggestions generated", { count: suggestions.length, suggestions })
    return NextResponse.json({ suggestions: suggestions.slice(0, 4) })
  } catch (err) {
    LOG("error", err)
    return NextResponse.json({ suggestions: [] }, { status: 200 })
  }
}
