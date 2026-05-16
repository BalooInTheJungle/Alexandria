import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type CleracDoc = {
  id: string;
  title: string | null;
  year: number | null;
  doi: string | null;
};

const CLERAC_ORCID = "0000-0001-5429-7418";
const OPENALEX_URL = `https://api.openalex.org/works?filter=authorships.author.orcid:https://orcid.org/${CLERAC_ORCID}&per_page=200&select=doi,title,publication_year`;

export async function GET() {
  console.log("[API] GET /api/corpus/clerac input:", { orcid: CLERAC_ORCID });
  try {
    const supabase = createAdminClient();

    // Fetch Clérac's publications from OpenAlex via ORCID
    const oaRes = await fetch(OPENALEX_URL, {
      headers: { "User-Agent": "Alexandria/1.0 (mailto:rodolphe.clerac@crpp.cnrs.fr)" },
    });
    if (!oaRes.ok) {
      console.error("[API] GET /api/corpus/clerac OpenAlex error:", oaRes.status);
      return NextResponse.json({ error: "OpenAlex unavailable" }, { status: 502 });
    }
    const oaData = await oaRes.json();
    const works: { doi?: string; title?: string; publication_year?: number }[] = oaData.results ?? [];

    // Extract normalized DOIs (strip URL prefix)
    const oaDois = works
      .map((w) => w.doi?.replace("https://doi.org/", "").toLowerCase().trim())
      .filter(Boolean) as string[];

    console.log("[API] GET /api/corpus/clerac OpenAlex:", { totalWorks: works.length, withDoi: oaDois.length });

    if (!oaDois.length) {
      return NextResponse.json({ docs: [], docIds: [], openAlexTotal: works.length });
    }

    // Match against our corpus by DOI
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, published_at, doi")
      .eq("status", "done")
      .not("doi", "is", null);

    if (error) {
      console.error("[API] GET /api/corpus/clerac DB error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const matched: CleracDoc[] = (data ?? [])
      .filter((row) => {
        const docDoi = (row.doi as string).toLowerCase().trim();
        return oaDois.includes(docDoi);
      })
      .map((row) => ({
        id: row.id,
        title: row.title ?? null,
        year: row.published_at ? new Date(row.published_at as string).getFullYear() : null,
        doi: row.doi as string,
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const docIds = matched.map((d) => d.id);

    console.log("[API] GET /api/corpus/clerac result:", {
      openAlexTotal: works.length,
      inCorpus: matched.length,
    });

    return NextResponse.json({
      docs: matched,
      docIds,
      openAlexTotal: works.length,
    });
  } catch (e) {
    console.error("[API] GET /api/corpus/clerac error:", e);
    return NextResponse.json({ error: "Clerac fetch failed" }, { status: 500 });
  }
}
