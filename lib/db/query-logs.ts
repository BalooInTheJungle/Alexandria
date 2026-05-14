import { createAdminClient } from "@/lib/supabase/admin";

const LOG = (msg: string, ...args: unknown[]) => console.log("[db/query-logs]", msg, ...args);

export type QueryLogInsert = {
  query_text: string;
  lang: "fr" | "en";
  chunks_retrieved: number;
  best_similarity: number | null;
  was_guardrailed: boolean;
  conversation_id: string | null;
};

export type DailyStatRow = {
  day: string;
  total: number;
  guardrailed: number;
  lang_fr: number;
  lang_en: number;
};

export async function insertQueryLog(entry: QueryLogInsert): Promise<void> {
  LOG("insertQueryLog input:", {
    lang: entry.lang,
    chunks_retrieved: entry.chunks_retrieved,
    best_similarity: entry.best_similarity,
    was_guardrailed: entry.was_guardrailed,
  });
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("query_logs").insert(entry);
    if (error) {
      LOG("insertQueryLog error:", error.message);
    } else {
      LOG("insertQueryLog result: ok");
    }
  } catch (e) {
    LOG("insertQueryLog error:", e);
  }
}

export type QueryAnalytics = {
  total: number;
  last30Days: number;
  guardrailedPct: number;
  langFrPct: number;
  dailyStats: DailyStatRow[];
  topQueries: { query_text: string; count: number }[];
};

export async function getQueryAnalytics(): Promise<QueryAnalytics> {
  LOG("getQueryAnalytics input:", {});
  const supabase = createAdminClient();

  const [
    { count: total },
    { data: daily },
    { data: recent },
  ] = await Promise.all([
    supabase.from("query_logs").select("id", { count: "exact", head: true }),
    supabase.rpc("get_query_stats_daily", { days_back: 30 }),
    supabase
      .from("query_logs")
      .select("query_text, was_guardrailed, lang")
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const rows = recent ?? [];
  const last30Days = rows.length;
  const guardrailed = rows.filter((r) => r.was_guardrailed).length;
  const fr = rows.filter((r) => r.lang === "fr").length;

  // Déduplique et compte les requêtes fréquentes (normalisation simple)
  const freq: Record<string, number> = {};
  for (const r of rows) {
    const key = r.query_text.trim().toLowerCase().slice(0, 120);
    freq[key] = (freq[key] ?? 0) + 1;
  }
  const topQueries = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query_text, count]) => ({ query_text, count }));

  const result: QueryAnalytics = {
    total: total ?? 0,
    last30Days,
    guardrailedPct: last30Days > 0 ? Math.round((guardrailed / last30Days) * 100) : 0,
    langFrPct: last30Days > 0 ? Math.round((fr / last30Days) * 100) : 0,
    dailyStats: (daily ?? []) as DailyStatRow[],
    topQueries,
  };

  LOG("getQueryAnalytics result:", {
    total: result.total,
    last30Days: result.last30Days,
    topQueriesCount: result.topQueries.length,
  });

  return result;
}
