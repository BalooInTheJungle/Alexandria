import { NextResponse } from "next/server"
import { embedQuery } from "@/lib/rag/embed"

export const maxDuration = 300

/**
 * GET /api/analyse/warmup
 * Précharge le modèle Xenova en mémoire (/tmp).
 * Appelé depuis le front dès que l'onglet Discussion est ouvert.
 */
export async function GET() {
  console.log("[API] GET /api/analyse/warmup — loading model")
  try {
    await embedQuery("warmup")
    console.log("[API] GET /api/analyse/warmup — model ready")
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[API] GET /api/analyse/warmup error:", err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
