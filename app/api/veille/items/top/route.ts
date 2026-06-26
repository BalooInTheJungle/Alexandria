import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listVeilleItems } from "@/lib/db/veille";
import { filterItemsForArticleDisplay } from "@/lib/veille/filter-article-display";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MIN_SCORE = 0.75;
const PAGE_SIZE = 10;

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[API] GET /api/veille/items/top", msg, ...args);

/**
 * GET /api/veille/items/top
 * Articles pertinents >= 80% de toutes les runs, paginés.
 * Query: page (défaut 1)
 * Returns: { items, total, page, pageSize, totalPages }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;
    const relevantParam = searchParams.get("relevant");
    const isRelevant = relevantParam === "true" ? true : relevantParam === "false" ? false : undefined;

    LOG("GET", { page, offset, minScore: MIN_SCORE, isRelevant });

    // Count total matching items
    const supabase = createAdminClient();
    let countQuery = supabase
      .from("veille_items")
      .select("id", { count: "exact", head: true })
      .gte("similarity_score", MIN_SCORE);
    if (isRelevant !== undefined) countQuery = countQuery.eq("is_relevant", isRelevant);

    const { count, error: countError } = await countQuery;

    if (countError) {
      LOG("count error", countError.message);
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    const total = count ?? 0;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    const rawItems = await listVeilleItems({ limit: PAGE_SIZE, offset, minScore: MIN_SCORE, isRelevant });
    const items = filterItemsForArticleDisplay(rawItems);

    LOG("ok", { total, page, returned: items.length });
    return NextResponse.json(
      { items, total, page, pageSize: PAGE_SIZE, totalPages },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    LOG("error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Top items failed" },
      { status: 500 }
    );
  }
}
