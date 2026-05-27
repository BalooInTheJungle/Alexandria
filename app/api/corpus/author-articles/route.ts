/**
 * GET /api/corpus/author-articles
 *
 * Retourne la liste paginée des articles publiés par le chercheur
 * (documents avec is_author_article = true).
 *
 * Query params :
 *   page     : numéro de page (défaut 1)
 *   pageSize : articles par page (défaut 50, max 200)
 *   year     : filtre sur l'année de publication (optionnel)
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type AuthorArticle = {
  id: string;
  title: string | null;
  journal: string | null;
  year: number | null;
  doi: string | null;
  authors: string[] | null;
};

export type AuthorArticlesResponse = {
  articles: AuthorArticle[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function GET(req: NextRequest) {
  console.log("[API] GET /api/corpus/author-articles input:", req.nextUrl.searchParams.toString());

  try {
    const { searchParams } = req.nextUrl;
    const page     = Math.max(1, parseInt(searchParams.get("page")     ?? "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50", 10)));
    const year     = searchParams.get("year") ? parseInt(searchParams.get("year")!, 10) : null;

    const supabase = createAdminClient();

    // Compter le total
    let countQuery = supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("is_author_article", true)
      .eq("status", "done");

    if (year) {
      countQuery = countQuery
        .gte("published_at", `${year}-01-01`)
        .lte("published_at", `${year}-12-31`);
    }

    const { count, error: countError } = await countQuery;
    if (countError) {
      console.error("[API] GET /api/corpus/author-articles count error:", countError.message);
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    const total      = count ?? 0;
    const totalPages = Math.ceil(total / pageSize);
    const from       = (page - 1) * pageSize;
    const to         = from + pageSize - 1;

    // Récupérer les articles paginés
    let dataQuery = supabase
      .from("documents")
      .select("id, title, journal, published_at, doi, authors")
      .eq("is_author_article", true)
      .eq("status", "done")
      .order("published_at", { ascending: false })
      .range(from, to);

    if (year) {
      dataQuery = dataQuery
        .gte("published_at", `${year}-01-01`)
        .lte("published_at", `${year}-12-31`);
    }

    const { data, error } = await dataQuery;
    if (error) {
      console.error("[API] GET /api/corpus/author-articles data error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const articles: AuthorArticle[] = (data ?? []).map((row) => ({
      id:      row.id,
      title:   row.title   ?? null,
      journal: row.journal ?? null,
      year:    row.published_at ? new Date(row.published_at as string).getFullYear() : null,
      doi:     row.doi     ?? null,
      authors: (row.authors as string[] | null) ?? null,
    }));

    console.log("[API] GET /api/corpus/author-articles result:", {
      total,
      page,
      pageSize,
      returned: articles.length,
      yearFilter: year,
    });

    return NextResponse.json({ articles, total, page, pageSize, totalPages } satisfies AuthorArticlesResponse);
  } catch (e) {
    console.error("[API] GET /api/corpus/author-articles error:", e);
    return NextResponse.json({ error: "Author articles fetch failed" }, { status: 500 });
  }
}
