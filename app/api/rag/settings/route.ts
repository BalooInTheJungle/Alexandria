import { NextResponse } from "next/server";
import {
  getRagSettings,
  validateRagSettingsPatch,
  updateRagSettings,
} from "@/lib/rag/settings";

/**
 * GET /api/rag/settings
 * Retourne toutes les clés/valeurs des paramètres RAG (pour le panneau admin).
 * Même structure que celle utilisée par le chat (nombres parsés, défauts appliqués).
 */
export async function GET() {
  try {
    const settings = await getRagSettings();
    return NextResponse.json(settings);
  } catch (e) {
    console.error("[RAG/settings] GET error", e);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/rag/settings
 * Body : objet partiel avec les clés à mettre à jour (ex. { "similarity_threshold": 0.4 }).
 * Validation des bornes ; en cas d’erreur → 400 sans modifier la base.
 * Clés acceptées : context_turns, similarity_threshold, guard_message, match_count,
 * match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const validation = validateRagSettingsPatch(body);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }
    if (Object.keys(validation.updates).length === 0) {
      const settings = await getRagSettings();
      return NextResponse.json(settings);
    }
    await updateRagSettings(validation.updates);
    const settings = await getRagSettings();
    return NextResponse.json(settings);
  } catch (e) {
    console.error("[RAG/settings] PATCH error", e);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
