import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export type MapPoint = {
  id: string;
  x: number;
  y: number;
  doc_id: string;
  doc_title: string | null;
};

const SAMPLE_SIZE = 3000;

export async function GET() {
  console.log("[API] GET /api/corpus/map input:", { sample: SAMPLE_SIZE });
  try {
    const supabase = createAdminClient();

    // Chunks avec coordonnées UMAP + document title via join
    const { data, error } = await supabase
      .from("chunks")
      .select("id, umap_x, umap_y, document_id, documents(title)")
      .not("umap_x", "is", null)
      .not("umap_y", "is", null)
      .limit(SAMPLE_SIZE);

    if (error) {
      console.error("[API] GET /api/corpus/map error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const points: MapPoint[] = (data ?? []).map((row) => ({
      id: row.id,
      x: row.umap_x as number,
      y: row.umap_y as number,
      doc_id: row.document_id,
      doc_title: (Array.isArray(row.documents) ? row.documents[0]?.title : (row.documents as { title?: string | null } | null)?.title) ?? null,
    }));

    console.log("[API] GET /api/corpus/map result:", { points: points.length });
    return NextResponse.json({ points, computed: points.length > 0 });
  } catch (e) {
    console.error("[API] GET /api/corpus/map error:", e);
    return NextResponse.json({ error: "Map failed" }, { status: 500 });
  }
}
