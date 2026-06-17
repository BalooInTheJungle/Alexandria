import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { parsePdfBuffer } from "@/lib/ingestion/parse-pdf"
import { chunkText } from "@/lib/ingestion/chunk"
import { embedQuery } from "@/lib/rag/embed"

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/analyse/upload", msg, ...args)

const MAX_FILE_SIZE = 20 * 1024 * 1024

function extractDoi(text: string): string | null {
  const match = text.match(/10\.\d{4,}(?:\.[\w.-]+)*\/[^\s]+/)
  if (!match) return null
  return match[0].replace(/[.,;:)\]\s]+$/, "").trim() || null
}

/**
 * POST /api/analyse/upload
 * Body: multipart/form-data avec un champ "file" (PDF unique).
 * Réponse: { analysisId, documentId, chunksCount, doi }
 *
 * Crée une entrée document_analyses + chunks temporaires (is_temp=true).
 * Les chunks sont supprimés automatiquement si l'analyse est supprimée (CASCADE).
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const entry = formData.get("file")

    if (!(entry instanceof File)) {
      return NextResponse.json({ error: "No PDF file in body. Send multipart/form-data with 'file'." }, { status: 400 })
    }
    if (entry.type !== "application/pdf") {
      return NextResponse.json({ error: "File must be a PDF." }, { status: 400 })
    }
    if (entry.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 20 MB limit." }, { status: 400 })
    }

    const filename = entry.name || "document.pdf"
    const title = filename.replace(/\.pdf$/i, "")
    LOG("start", { filename, size: entry.size })

    const buffer = Buffer.from(await entry.arrayBuffer())

    // Parse PDF
    const { text, numpages } = await parsePdfBuffer(buffer)
    if (!text) {
      return NextResponse.json({ error: "No text could be extracted from this PDF." }, { status: 422 })
    }
    LOG("parsed", { numpages, textLength: text.length })

    const doi = extractDoi(text)

    // Créer l'entrée document_analyses
    const { data: analysis, error: analysisError } = await supabase
      .from("document_analyses")
      .insert({
        user_id: user.id,
        title,
        doi,
        status: "processing",
      })
      .select("id")
      .single()

    if (analysisError || !analysis) {
      LOG("analysis insert error", analysisError?.message)
      return NextResponse.json({ error: "Failed to create analysis record." }, { status: 500 })
    }

    const analysisId = analysis.id
    LOG("analysis created", { analysisId, doi })

    // Créer le document lié
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        storage_path: `analyse/${analysisId}.pdf`,
        status: "processing",
        title,
        doi: doi ?? null,
      })
      .select("id")
      .single()

    if (docError || !doc) {
      LOG("document insert error", docError?.message)
      await supabase.from("document_analyses").update({ status: "error" }).eq("id", analysisId)
      return NextResponse.json({ error: "Failed to create document record." }, { status: 500 })
    }

    const documentId = doc.id

    // Lier le document à l'analyse
    await supabase.from("document_analyses").update({ document_id: documentId }).eq("id", analysisId)

    // Chunk + embed
    const segments = chunkText(text)
    LOG("chunked", { segments: segments.length })

    const EMBED_BATCH = 20
    let totalInserted = 0

    for (let i = 0; i < segments.length; i += EMBED_BATCH) {
      const batch = segments.slice(i, i + EMBED_BATCH)
      const rows: object[] = []

      for (const seg of batch) {
        const embedding = await embedQuery(seg.content)
        rows.push({
          document_id: documentId,
          analysis_id: analysisId,
          is_temp: true,
          content: seg.content,
          position: seg.position,
          page: seg.page ?? null,
          section_title: seg.section_title ?? null,
          embedding,
        })
      }

      const { error: insertError } = await supabase.from("chunks").insert(rows)
      if (insertError) {
        LOG("chunks insert error", insertError.message)
        await supabase.from("document_analyses").update({ status: "error" }).eq("id", analysisId)
        return NextResponse.json({ error: "Failed to insert chunks." }, { status: 500 })
      }

      totalInserted += rows.length
      LOG("batch embedded", { batch: Math.floor(i / EMBED_BATCH) + 1, totalInserted })
    }

    // Marquer processing → ready (insights pas encore calculés)
    await Promise.all([
      supabase.from("document_analyses").update({ status: "ready" }).eq("id", analysisId),
      supabase.from("documents").update({
        status: "done",
        ingestion_log: { numpages, chunks_count: totalInserted, ingested_at: new Date().toISOString() },
      }).eq("id", documentId),
    ])

    LOG("done", { analysisId, documentId, totalInserted, doi })
    return NextResponse.json({ analysisId, documentId, chunksCount: totalInserted, doi })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    LOG("error", msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
