import { NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@/lib/supabase/server"
import { embedQuery } from "@/lib/rag/embed"

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/analyse/[id]/insights", msg, ...args)

const SS_API = "https://api.semanticscholar.org/graph/v1/paper"
const SS_RECS_API = "https://api.semanticscholar.org/recommendations/v1/papers/"
const SS_FIELDS = "paperId,title,authors,year,externalIds,abstract"

function getOpenAI() {
  const key = (process.env.OPENAI_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim()
  if (!key) throw new Error("OPENAI_API_KEY not set")
  return new OpenAI({ apiKey: key })
}

function getSsHeaders(): Record<string, string> {
  const key = process.env.SS_API_KEY
  return key ? { "x-api-key": key } : {}
}

/** Extrait les DOIs cités dans la section References du texte. */
function extractCitedDois(text: string): string[] {
  const dois = new Set<string>()
  let m: RegExpExecArray | null
  const re = /10\.\d{4,}(?:\.[\w.-]+)*\/[^\s,;)\]"]+/g
  while ((m = re.exec(text)) !== null) {
    const doi = m[0].replace(/[.,;:)\]\s]+$/, "").trim()
    if (doi) dois.add(doi.toLowerCase())
  }
  return Array.from(dois)
}

/** Cherche le paperId SS via DOI. */
async function fetchSsPaperId(doi: string): Promise<string | null> {
  try {
    const res = await fetch(`${SS_API}/DOI:${encodeURIComponent(doi)}?fields=paperId`, {
      headers: getSsHeaders(),
    })
    if (!res.ok) return null
    const json = await res.json()
    return (json as { paperId?: string }).paperId ?? null
  } catch {
    return null
  }
}

/** Cherche les métadonnées SS pour une liste de DOIs (batch). */
async function fetchSsMetadataBatch(dois: string[]): Promise<Map<string, { title: string; year: number | null; authors: string[] }>> {
  const result = new Map<string, { title: string; year: number | null; authors: string[] }>()
  if (dois.length === 0) return result
  try {
    const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds,title,authors,year`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getSsHeaders() },
      body: JSON.stringify({ ids: dois.map((d) => `DOI:${d}`) }),
    })
    if (!res.ok) return result
    const papers = (await res.json()) as Array<{ externalIds?: { DOI?: string }; title?: string; year?: number; authors?: Array<{ name: string }> } | null>
    for (const p of papers) {
      if (!p?.externalIds?.DOI) continue
      result.set(p.externalIds.DOI.toLowerCase(), {
        title: p.title ?? "",
        year: p.year ?? null,
        authors: (p.authors ?? []).map((a) => a.name),
      })
    }
  } catch {
    // SS batch optionnel — on continue sans
  }
  return result
}

/** Génère le résumé structuré via GPT à partir des chunks de l'analyse. */
async function generateSummary(chunks: Array<{ content: string; section_title: string | null }>): Promise<{
  tldr: string
  intro: string
  methods: string
  results: string
  discussion: string
}> {
  const openai = getOpenAI()

  // Groupe les chunks par section, max 3000 tokens total
  const sections: Record<string, string[]> = {}
  let totalChars = 0
  for (const c of chunks) {
    if (totalChars > 12000) break
    const key = c.section_title?.toLowerCase() ?? "body"
    if (!sections[key]) sections[key] = []
    sections[key].push(c.content)
    totalChars += c.content.length
  }

  const context = Object.entries(sections)
    .map(([sec, texts]) => `## ${sec}\n${texts.slice(0, 3).join("\n")}`)
    .join("\n\n")
    .slice(0, 14000)

  const prompt = `Tu es un assistant de recherche scientifique. Voici le contenu d'un article scientifique.
Rédige un résumé structuré en français avec ces 5 sections (2-3 phrases chacune) :
- tldr : une phrase résumant l'essentiel
- intro : problème posé et contexte
- methods : approche et méthodes utilisées
- results : principaux résultats obtenus
- discussion : implications et limites

Réponds UNIQUEMENT en JSON valide avec les clés : tldr, intro, methods, results, discussion.

ARTICLE :
${context}`

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  })

  const raw = resp.choices[0]?.message?.content ?? "{}"
  return JSON.parse(raw)
}

/**
 * GET /api/analyse/[id]/insights
 * Lance en parallèle : résumé GPT + passages corpus + références croisées + recs SS.
 * Sauvegarde les résultats dans document_analyses et retourne l'analyse enrichie.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Charger l'analyse
  const { data: analysis, error: analysisError } = await supabase
    .from("document_analyses")
    .select("*")
    .eq("id", analysisId)
    .eq("user_id", user.id)
    .single()

  if (analysisError || !analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
  }

  if (analysis.status === "completed") {
    LOG("cache hit", { analysisId })
    return NextResponse.json(analysis)
  }

  if (analysis.status !== "ready") {
    return NextResponse.json({ error: `Analysis not ready (status: ${analysis.status})` }, { status: 409 })
  }

  LOG("start insights", { analysisId, doi: analysis.doi })

  // Marquer en processing
  await supabase.from("document_analyses").update({ status: "processing" }).eq("id", analysisId)

  try {
    // Charger les chunks temporaires de cette analyse
    const { data: chunks, error: chunksError } = await supabase
      .from("chunks")
      .select("content, section_title, embedding, page, position")
      .eq("analysis_id", analysisId)
      .eq("is_temp", true)
      .order("position")

    if (chunksError || !chunks || chunks.length === 0) {
      throw new Error("No chunks found for this analysis")
    }

    LOG("chunks loaded", { count: chunks.length })

    // Embedding moyen de tous les chunks → représente l'article entier
    const dim = (chunks[0].embedding as number[]).length
    const meanEmbedding = new Array(dim).fill(0) as number[]
    for (const c of chunks) {
      const emb = c.embedding as number[]
      for (let i = 0; i < dim; i++) meanEmbedding[i] += emb[i]
    }
    for (let i = 0; i < dim; i++) meanEmbedding[i] /= chunks.length

    // Texte complet pour extraction des DOIs cités
    const fullText = chunks.map((c) => c.content).join("\n")
    const citedDois = extractCitedDois(fullText)
    LOG("cited DOIs extracted", { count: citedDois.length })

    // Lancer tout en parallèle
    const [summaryResult, corpusResult, citedMetaMap, ssPaperIdResult, ssRecsResult] = await Promise.allSettled([

      // 1. Résumé GPT
      generateSummary(chunks),

      // 2. Passages corpus les plus proches (match_chunks, exclure chunks is_temp)
      supabase.rpc("match_chunks", {
        query_embedding: meanEmbedding,
        match_threshold: 0.5,
        match_count: 8,
      }).then(({ data, error }) => {
        if (error) throw error
        // Filtrer les chunks de cette analyse (is_temp)
        return ((data ?? []) as Array<{
          id: string; document_id: string; content: string; page: number | null
          section_title: string | null; similarity: number; doc_title: string | null
        }>).filter((c) => c.document_id !== analysis.document_id)
      }),

      // 3. Métadonnées SS pour les DOIs cités
      fetchSsMetadataBatch(citedDois.slice(0, 30)),

      // 4. paperId SS de l'article analysé (via son DOI)
      analysis.doi ? fetchSsPaperId(analysis.doi) : Promise.resolve(null),

      // 5. Recommandations SS (si paperId connu dès maintenant — sinon on fera après)
      Promise.resolve(null),
    ])

    // Recommandations SS : nécessite paperId → peut venir de ss_paper_id existant ou du fetch
    let ssRecs: Array<{ title: string; authors: string[]; year: number | null; doi: string | null; abstract: string | null }> = []
    const ssPaperId = ssPaperIdResult.status === "fulfilled" ? ssPaperIdResult.value : null

    if (ssPaperId) {
      try {
        const recsRes = await fetch(
          `${SS_RECS_API}?fields=${SS_FIELDS}&limit=10`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getSsHeaders() },
            body: JSON.stringify({ positivePaperIds: [ssPaperId], negativePaperIds: [] }),
          }
        )
        if (recsRes.ok) {
          const json = await recsRes.json() as { recommendedPapers?: Array<{ title?: string; authors?: Array<{ name: string }>; year?: number; externalIds?: { DOI?: string }; abstract?: string }> }
          ssRecs = (json.recommendedPapers ?? []).map((p) => ({
            title: p.title ?? "",
            authors: (p.authors ?? []).map((a) => a.name),
            year: p.year ?? null,
            doi: p.externalIds?.DOI ?? null,
            abstract: p.abstract ?? null,
          }))
          LOG("ss recs fetched", { count: ssRecs.length })
        }
      } catch {
        LOG("ss recs error — skipped")
      }
    }

    // Construire corpus_refs
    const corpusRefs = corpusResult.status === "fulfilled"
      ? corpusResult.value.slice(0, 6).map((c) => ({
          doc_title: c.doc_title,
          excerpt: c.content.slice(0, 300),
          page: c.page,
          similarity: Math.round(c.similarity * 1000) / 1000,
        }))
      : []

    // Construire cited_refs avec croisement corpus
    const metaMap = citedMetaMap.status === "fulfilled" ? citedMetaMap.value : new Map()

    // Vérifier quels DOIs cités sont déjà dans le corpus
    const { data: corpusDocs } = await supabase
      .from("documents")
      .select("doi, title")
      .in("doi", citedDois.slice(0, 30))
      .eq("status", "done")

    const corpusDoiSet = new Set((corpusDocs ?? []).map((d) => d.doi?.toLowerCase()))

    const citedRefs = citedDois.slice(0, 30).map((doi) => {
      const meta = metaMap.get(doi)
      const inCorpus = corpusDoiSet.has(doi)
      return {
        doi,
        in_corpus: inCorpus,
        title: meta?.title ?? null,
        year: meta?.year ?? null,
        authors: meta?.authors ?? [],
      }
    })

    LOG("cited refs built", { total: citedRefs.length, inCorpus: citedRefs.filter((r) => r.in_corpus).length })

    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null

    // Sauvegarder et retourner
    const { data: updated, error: updateError } = await supabase
      .from("document_analyses")
      .update({
        status: "completed",
        ss_paper_id: ssPaperId,
        summary,
        corpus_refs: corpusRefs,
        cited_refs: citedRefs,
        ss_recs: ssRecs,
      })
      .eq("id", analysisId)
      .select("*")
      .single()

    if (updateError || !updated) throw new Error("Failed to save insights")

    LOG("done", { analysisId, corpusRefs: corpusRefs.length, citedRefs: citedRefs.length, ssRecs: ssRecs.length })
    return NextResponse.json(updated)

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    LOG("error", msg)
    await supabase.from("document_analyses").update({ status: "error" }).eq("id", analysisId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
