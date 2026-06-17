import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] POST /api/analyse/[id]/integrate", msg, ...args)

/**
 * POST /api/analyse/[id]/integrate
 * Rend les chunks temporaires de cette analyse permanents dans le corpus.
 * - is_temp → false
 * - expires_at → null
 * - is_integrated → true
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("document_analyses")
    .select("id, is_integrated, document_id")
    .eq("id", analysisId)
    .eq("user_id", user.id)
    .single()

  if (analysisError || !analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
  }

  if (analysis.is_integrated) {
    return NextResponse.json({ message: "Already integrated" })
  }

  LOG("integrating", { analysisId, documentId: analysis.document_id })

  const [chunksResult, analysisResult] = await Promise.all([
    supabase
      .from("chunks")
      .update({ is_temp: false })
      .eq("analysis_id", analysisId),
    supabase
      .from("document_analyses")
      .update({ is_integrated: true, expires_at: null })
      .eq("id", analysisId),
  ])

  if (chunksResult.error) {
    LOG("chunks update error", chunksResult.error.message)
    return NextResponse.json({ error: chunksResult.error.message }, { status: 500 })
  }
  if (analysisResult.error) {
    LOG("analysis update error", analysisResult.error.message)
    return NextResponse.json({ error: analysisResult.error.message }, { status: 500 })
  }

  LOG("integrated", { analysisId })
  return NextResponse.json({ success: true })
}
