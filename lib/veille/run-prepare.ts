/**
 * Phase préparation : fetch sources, extract URLs, filter, insert dans veille_run_urls.
 * Ne traite pas les articles — c'est fait par process-batch.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { listSourcesFromDb } from "./sources";
import { fetchSourcePages } from "./fetch-source-pages";
import { extractUrlsFromHtml, extractUrlsFromRss, isRssOrAtom } from "./extract-urls";
import {
  getExistingDois,
  getExistingArticleUrls,
  removeExistingUrls,
  filterArticleCandidateUrls,
  applyUrlQuotas,
} from "./guardrails";
import { filterUrlsWithLlm } from "./filter-urls-llm";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/run-prepare]", new Date().toISOString(), msg, ...args);

export type PrepareResult = { ok: boolean; count: number };

export async function runVeillePrepare(runId: string): Promise<PrepareResult> {
  const startTime = Date.now();
  LOG("runVeillePrepare start", { runId });
  const supabase = createAdminClient();

  try {
    LOG("updating run status to running");
    await supabase
      .from("veille_runs")
      .update({ status: "running", started_at: new Date().toISOString(), phase: "sources" })
      .eq("id", runId);

    const sources = await listSourcesFromDb(supabase);
    LOG("sources loaded", { count: sources.length });
    if (sources.length === 0) {
      await supabase
        .from("veille_runs")
        .update({ status: "completed", completed_at: new Date().toISOString(), phase: "done" })
        .eq("id", runId);
      return { ok: true, count: 0 };
    }

    const pages = await fetchSourcePages(
      sources.map((s) => ({ id: s.id, url: s.url, fetch_strategy: s.fetch_strategy ?? "auto" }))
    );
    const sourceUrls: { sourceId: string; url: string }[] = [];
    for (const p of pages) {
      const urls = isRssOrAtom(p.html)
        ? extractUrlsFromRss(p.html, p.url)
        : extractUrlsFromHtml(p.html, p.url);
      for (const url of urls) sourceUrls.push({ sourceId: p.sourceId, url });
    }
    LOG("urls extracted", { total: sourceUrls.length });
    await supabase.from("veille_runs").update({ phase: "urls" }).eq("id", runId);

    LOG("filterArticleCandidateUrls start", { input: sourceUrls.length });
    const filtered = filterArticleCandidateUrls(sourceUrls);
    LOG("filterArticleCandidateUrls done", { output: filtered.length });
    const existingUrls = await getExistingArticleUrls(supabase);
    const withoutExisting = removeExistingUrls(filtered, existingUrls);
    LOG("removeExistingUrls done", { before: filtered.length, after: withoutExisting.length });
    LOG("filterUrlsWithLlm start", { input: withoutExisting.length });
    const filteredByLlm = await filterUrlsWithLlm(withoutExisting);
    LOG("after LLM filter", { count: filteredByLlm.length });
    await supabase.from("veille_runs").update({ phase: "filter" }).eq("id", runId);

    const existingDois = await getExistingDois(supabase);
    const toProcess = applyUrlQuotas(filteredByLlm, existingDois);
    LOG("after guardrails", { toProcess: toProcess.length });

    if (toProcess.length === 0) {
      await supabase
        .from("veille_runs")
        .update({ status: "completed", completed_at: new Date().toISOString(), phase: "done" })
        .eq("id", runId);
      await supabase
        .from("sources")
        .update({ last_checked_at: new Date().toISOString() })
        .in("id", sources.map((s) => s.id));
      return { ok: true, count: 0 };
    }

    LOG("inserting veille_run_urls", { count: toProcess.length });
    await supabase.from("veille_run_urls").delete().eq("run_id", runId);
    const rows = toProcess.map(({ sourceId, url }, i) => ({
      run_id: runId,
      source_id: sourceId,
      url,
      position: i,
      status: "pending",
    }));
    const { error: insertErr } = await supabase.from("veille_run_urls").insert(rows);
    if (insertErr) {
      LOG("insert veille_run_urls error", insertErr.message);
      throw insertErr;
    }

    await supabase
      .from("veille_runs")
      .update({ phase: "items", items_total: toProcess.length, items_processed: 0 })
      .eq("id", runId);

    LOG("prepare done", { count: toProcess.length, elapsedMs: Date.now() - startTime });
    return { ok: true, count: toProcess.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    LOG("prepare failed", msg);
    await supabase
      .from("veille_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), error_message: msg.slice(0, 1000) })
      .eq("id", runId);
    return { ok: false, count: 0 };
  }
}
