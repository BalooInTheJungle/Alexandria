import { NextResponse } from "next/server";
import { listVeilleItems } from "@/lib/db/veille";
import { filterItemsForArticleDisplay } from "@/lib/veille/filter-article-display";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/veille/items", msg, ...args);

/**
 * GET /api/veille/items
 * Liste des veille_items avec nom source et document_id si intégré en DB (match DOI).
 * Garde-fou : ne retourne que les items considérés comme articles (titre ou abstract ou DOI extraits,
 * et titre pas dans la liste des pages institutionnelles) pour que la synthèse n'affiche pas de lignes parasites.
 * Query: runId?, sourceId?, limit (défaut 100), offset (défaut 0).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") ?? undefined;
    const sourceId = searchParams.get("sourceId") ?? undefined;
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "100", 10) || 100));
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
    LOG("GET", { runId, sourceId, limit, offset });
    const rawItems = await listVeilleItems({ runId, sourceId, limit, offset });
    const items = filterItemsForArticleDisplay(rawItems);
    LOG("ok", { count: items.length, filtered: rawItems.length - items.length });
    return NextResponse.json(items);
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List items failed" },
      { status: 500 }
    );
  }
}
