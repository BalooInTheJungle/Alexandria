import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/analyse/[id]/pdf", msg, ...args)

/**
 * GET /api/analyse/[id]/pdf
 * Retourne une URL signée (1h) pour accéder au PDF dans Supabase Storage.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: analysisId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Vérifier que l'analyse appartient à l'utilisateur
  const { data: analysis } = await supabase
    .from("document_analyses")
    .select("id")
    .eq("id", analysisId)
    .eq("user_id", user.id)
    .single()

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 })
  }

  const { data, error } = await supabase.storage
    .from("analyses")
    .createSignedUrl(`${analysisId}.pdf`, 3600)

  if (error || !data?.signedUrl) {
    LOG("signed url error", error?.message)
    return NextResponse.json({ error: "PDF not available" }, { status: 404 })
  }

  LOG("signed url created", { analysisId })
  return NextResponse.json({ url: data.signedUrl })
}
