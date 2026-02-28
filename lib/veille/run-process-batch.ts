/**
 * Traitement d'un lot d'URLs : extrait article, calcule scores, insère dans veille_items.
 * Lit les URLs pending depuis veille_run_urls, met à jour status.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { extractArticleFromUrl } from "./extract-article-llm";
import { computeScores, getCorpusTopTerms } from "./score";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/run-process-batch]", new Date().toISOString(), msg, ...args);

export type ProcessBatchResult = { processed: number; hasMore: boolean };

/** Réduit le risque de timeout Vercel (5 min) sur sources lentes (ex. Nature). */
const DEFAULT_BATCH_SIZE = 5;

export async function runVeilleProcessBatch(
  runId: string,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<ProcessBatchResult> {
  const supabase = createAdminClient();

  const { data: runRow } = await supabase
    .from("veille_runs")
    .select("abort_requested, status")
    .eq("id", runId)
    .maybeSingle();

  if (runRow?.abort_requested) {
    LOG("abort requested, stopping run", runId);
    await supabase
      .from("veille_runs")
      .update({
        status: "stopped",
        completed_at: new Date().toISOString(),
        error_message: "Arrêt demandé par l'utilisateur",
        phase: "done",
      })
      .eq("id", runId);
    return { processed: 0, hasMore: false };
  }

  if (runRow?.status && !["running"].includes(runRow.status)) {
    LOG("run not running, skip batch", { runId, status: runRow.status });
    return { processed: 0, hasMore: false };
  }

  const { data: rows, error: selectErr } = await supabase
    .from("veille_run_urls")
    .select("id, source_id, url")
    .eq("run_id", runId)
    .eq("status", "pending")
    .order("position", { ascending: true })
    .limit(batchSize);

  if (selectErr) {
    LOG("select pending urls error", selectErr.message);
    throw selectErr;
  }
  if (!rows || rows.length === 0) {
    LOG("no pending urls, completing run", runId);
    const sourceIds = await getSourceIdsForRun(supabase, runId);
    if (sourceIds.length > 0) {
      await supabase
        .from("sources")
        .update({ last_checked_at: new Date().toISOString() })
        .in("id", sourceIds);
    }
    await supabase
      .from("veille_runs")
      .update({ status: "completed", completed_at: new Date().toISOString(), phase: "done" })
      .eq("id", runId);
    return { processed: 0, hasMore: false };
  }

  const corpusTerms = await getCorpusTopTerms(supabase, 80);
  LOG("batch start", { runId, count: rows.length, corpusTermsCount: corpusTerms.length });

  let inserted = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    LOG("article start", { index: idx + 1, total: rows.length, url: row.url.slice(0, 60) });
    const { data: abortRow } = await supabase
      .from("veille_runs")
      .select("abort_requested")
      .eq("id", runId)
      .maybeSingle();
    if (abortRow?.abort_requested) {
      LOG("abort requested mid-batch");
      await supabase
        .from("veille_runs")
        .update({
          status: "stopped",
          completed_at: new Date().toISOString(),
          error_message: "Arrêt demandé par l'utilisateur",
          phase: "done",
        })
        .eq("id", runId);
      return { processed: inserted, hasMore: false };
    }

    const { source_id: sourceId, url } = row;
    LOG("article fetch start", { index: idx + 1, url: url.slice(0, 60) });
    const article = await extractArticleFromUrl(url);
    LOG("article fetch done", {
      index: idx + 1,
      hasTitle: !!article.title?.trim(),
      hasDoi: !!article.doi?.trim(),
      lastError: article.last_error ?? null,
    });
    const hasTitle = Boolean(article.title?.trim());
    const hasDoi = Boolean(article.doi?.trim());
    if (!hasTitle && !hasDoi) {
      LOG("skip (no title nor DOI)", { index: idx + 1, url: url.slice(0, 50), lastError: article.last_error });
      await supabase.from("veille_run_urls").update({ status: "skipped" }).eq("id", row.id);
      continue;
    }

    LOG("article scores start", { index: idx + 1 });
    const { heuristic_score, similarity_score } = await computeScores(
      supabase,
      url,
      article.title,
      article.abstract,
      corpusTerms
    );
    LOG("article scores done", { index: idx + 1, heuristic_score, similarity_score });

    LOG("article insert start", { index: idx + 1, title: article.title?.slice(0, 40) });
    const { error: insertErr } = await supabase.from("veille_items").insert({
      run_id: runId,
      source_id: sourceId,
      url,
      title: article.title,
      authors: article.authors.length > 0 ? article.authors : null,
      doi: article.doi,
      abstract: article.abstract,
      published_at: article.published_at || null,
      heuristic_score,
      similarity_score,
      last_error: article.last_error ?? null,
    });

    if (insertErr) {
      LOG("insert item error", { index: idx + 1, err: insertErr.message, url: url.slice(0, 50) });
      await supabase.from("veille_run_urls").update({ status: "skipped" }).eq("id", row.id);
    } else {
      inserted++;
      LOG("article inserted ok", { index: idx + 1, inserted, title: article.title?.slice(0, 40) });
      await supabase.from("veille_run_urls").update({ status: "processed" }).eq("id", row.id);
      // items_processed = articles réellement insérés (aligné avec items_count / Historique)
      await incrementRunItemsProcessed(supabase, runId);
    }
    LOG("article done", { index: idx + 1, total: rows.length });
  }

  const { count } = await supabase
    .from("veille_run_urls")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "pending");
  const pendingCount = count ?? 0;
  const hasMore = pendingCount > 0;

  LOG("batch done", { runId, processed: inserted, pendingRemaining: pendingCount, hasMore });
  return { processed: inserted, hasMore };
}

async function incrementRunItemsProcessed(
  supabase: ReturnType<typeof createAdminClient>,
  runId: string
): Promise<void> {
  const { data } = await supabase
    .from("veille_runs")
    .select("items_processed")
    .eq("id", runId)
    .maybeSingle();
  const prev = (data?.items_processed ?? 0) as number;
  await supabase.from("veille_runs").update({ items_processed: prev + 1 }).eq("id", runId);
}

async function getSourceIdsForRun(supabase: ReturnType<typeof createAdminClient>, runId: string): Promise<string[]> {
  const { data } = await supabase
    .from("veille_run_urls")
    .select("source_id")
    .eq("run_id", runId)
    .limit(500);
  const ids = Array.from(new Set((data ?? []).map((r) => r.source_id)));
  return ids;
}
