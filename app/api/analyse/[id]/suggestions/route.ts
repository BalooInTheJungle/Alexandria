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
    .select("id, title, summary")
    .eq("id", analysisId)
    .eq("user_id", user.id)
    .single()

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
  }

  LOG("generating suggestions", { title: analysis.title, hasSummary: !!analysis.summary })

  const summary = analysis.summary as {
    tldr?: string; methods?: string; results?: string
  } | null

  const context = [
    `Titre : ${analysis.title ?? "Document scientifique"}`,
    summary?.tldr ? `Résumé : ${summary.tldr}` : "",
    summary?.methods ? `Méthodes : ${summary.methods}` : "",
    summary?.results ? `Résultats : ${summary.results}` : "",
  ].filter(Boolean).join("\n")

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `Tu es un assistant de recherche scientifique.
Génère exactement 4 questions pertinentes qu'un chercheur pourrait poser sur ce document.
Les questions doivent porter sur les méthodes, résultats, implications, ou connexions avec d'autres travaux.
Réponds uniquement avec un tableau JSON de 4 strings, sans explication. Exemple : ["Question 1 ?", "Question 2 ?", "Question 3 ?", "Question 4 ?"]`,
        },
        {
          role: "user",
          content: context,
        },
      ],
    })

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]"
    LOG("raw response", raw)

    const match = raw.match(/\[[\s\S]*\]/)
    const suggestions: string[] = match ? JSON.parse(match[0]) : []

    LOG("suggestions generated", { count: suggestions.length })
    return NextResponse.json({ suggestions: suggestions.slice(0, 4) })
  } catch (err) {
    LOG("error", err)
    return NextResponse.json({ suggestions: [] }, { status: 200 })
  }
}
