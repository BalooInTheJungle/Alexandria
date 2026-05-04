import { NextResponse } from "next/server";
import {
  getRagSettings,
  updateRagSettings,
  type RagSettings,
} from "@/lib/rag/settings";

/**
 * GET /api/rag/settings
 * Retourne toutes les clés/valeurs des paramètres RAG (pour l'admin).
 */
export async function GET() {
  try {
    const settings = await getRagSettings();
    return NextResponse.json(settings);
  } catch (e) {
    console.error("[API] GET /api/rag/settings", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/rag/settings
 * Met à jour des clés. Body : objet partiel RagSettings.
 * Valide les bornes ; en cas d'erreur retourne 400 sans modifier la base.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object") {
      return NextResponse.json(
        { error: "Body must be a JSON object" },
        { status: 400 }
      );
    }

    const partial: Partial<RagSettings> = {};
    const allowed: (keyof RagSettings)[] = [
      "use_similarity_guard",
      "context_turns",
      "similarity_threshold",
      "guard_message",
      "match_count",
      "match_threshold",
      "fts_weight",
      "vector_weight",
      "rrf_k",
      "hybrid_top_k",
    ];

    for (const key of allowed) {
      if (body[key] !== undefined) {
        (partial as Record<string, unknown>)[key] = body[key];
      }
    }

    if (Object.keys(partial).length === 0) {
      return NextResponse.json(
        { error: "Body must include at least one setting key" },
        { status: 400 }
      );
    }

    const result = await updateRagSettings(partial);

    if ("ok" in result && result.ok === false) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[API] PATCH /api/rag/settings", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
