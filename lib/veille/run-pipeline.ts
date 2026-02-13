/**
 * Exécution d'une run de la pipeline veille (toutes les sources).
 * Utilise le client admin pour pouvoir tourner en arrière-plan.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { listSourcesFromDb } from "./sources";
import { fetchSourcePages } from "./fetch-source-pages";
import { extractUrlsFromHtml, extractUrlsFromRss, isRssOrAtom } from "./extract-urls";
import { isLikelyBotChallenge } from "./detect-bot-challenge";
import {
  getExistingDois,
  getExistingArticleUrls,
  removeExistingUrls,
  filterArticleCandidateUrls,
  applyUrlQuotas,
} from "./guardrails";
import { filterUrlsWithLlm } from "./filter-urls-llm";
import { extractArticleFromUrl } from "./extract-article-llm";
import { computeScores } from "./score";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/run-pipeline]", msg, ...args);

export async function runVeillePipeline(runId: string): Promise<void> {
  LOG("runVeillePipeline start", { runId });
  const supabase = createAdminClient();

  try {
    const { error: updateErr } = await supabase
      .from("veille_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId);
    if (updateErr) {
      LOG("runVeillePipeline update status error", updateErr.message);
      throw updateErr;
    }
    LOG("runVeillePipeline status=running");

    const sources = await listSourcesFromDb(supabase);
    if (sources.length === 0) {
      LOG("runVeillePipeline no sources, completing");
      await supabase
        .from("veille_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      return;
    }

    const pages = await fetchSourcePages(
      sources.map((s) => ({
        id: s.id,
        url: s.url,
        fetch_strategy: s.fetch_strategy ?? "auto",
      }))
    );
    const sourceUrls: { sourceId: string; url: string }[] = [];
    for (const p of pages) {
      const urls = isRssOrAtom(p.html)
        ? extractUrlsFromRss(p.html, p.url)
        : extractUrlsFromHtml(p.html, p.url);
      for (const url of urls) sourceUrls.push({ sourceId: p.sourceId, url });
      LOG("runVeillePipeline urls from source", {
        sourceUrl: p.url,
        count: urls.length,
        urls: urls.slice(0, 80),
        ...(urls.length > 80 ? { _truncated: true, total: urls.length } : {}),
      });
      if (urls.length === 0) {
        const likelyBot = !isRssOrAtom(p.html) && isLikelyBotChallenge(p.html, p.url);
        LOG("runVeillePipeline source has 0 URLs", {
          sourceUrl: p.url,
          likelyBotChallenge: likelyBot,
          hint: likelyBot
            ? "Use RSS URL for this source to bypass anti-bot."
            : "Page may be JS-rendered; try RSS or a direct journal TOC URL.",
        });
      }
    }
    LOG("runVeillePipeline urls extracted", { total: sourceUrls.length });

    const filtered = filterArticleCandidateUrls(sourceUrls);
    LOG("runVeillePipeline urls after prefilter", {
      count: filtered.length,
      sample: filtered.slice(0, 30).map((u) => u.url),
    });
    const existingUrls = await getExistingArticleUrls(supabase);
    const withoutExisting = removeExistingUrls(filtered, existingUrls);
    const filteredByLlm = await filterUrlsWithLlm(withoutExisting);
    LOG("runVeillePipeline after LLM filter", { count: filteredByLlm.length });
    const existingDois = await getExistingDois(supabase);
    const toProcess = applyUrlQuotas(filteredByLlm, existingDois);
    LOG("runVeillePipeline after guardrails", { toProcess: toProcess.length });

    if (toProcess.length === 0) {
      LOG("runVeillePipeline no URLs to process, completing run");
      await supabase
        .from("veille_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
      await supabase
        .from("sources")
        .update({ last_checked_at: new Date().toISOString() })
        .in("id", sources.map((s) => s.id));
      return;
    }

    LOG("runVeillePipeline processing items", { count: toProcess.length });
    let inserted = 0;
    for (let i = 0; i < toProcess.length; i++) {
      const { sourceId, url } = toProcess[i];
      LOG("runVeillePipeline item start", { index: i + 1, total: toProcess.length, url: url.slice(0, 60) });
      const article = await extractArticleFromUrl(url);
      const hasTitle = Boolean(article.title?.trim());
      const hasDoi = Boolean(article.doi?.trim());
      if (!hasTitle && !hasDoi) {
        LOG("runVeillePipeline item skip (no title nor DOI)", { index: i + 1, url: url.slice(0, 50) });
        continue;
      }
      const { heuristic_score, similarity_score } = await computeScores(
        supabase,
        url,
        article.title,
        article.abstract
      );
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
        LOG("runVeillePipeline insert item error", { index: i + 1, url: url.slice(0, 50), err: insertErr.message });
      } else {
        inserted++;
        LOG("runVeillePipeline item ok", { index: i + 1, inserted, title: article.title?.slice(0, 40) });
      }
    }

    LOG("runVeillePipeline updating last_checked_at for sources");
    const sourceIds = Array.from(new Set(sources.map((s) => s.id)));
    await supabase
      .from("sources")
      .update({ last_checked_at: new Date().toISOString() })
      .in("id", sourceIds);

    const { error: completeErr } = await supabase
      .from("veille_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (completeErr) LOG("runVeillePipeline complete update error", completeErr.message);
    LOG("runVeillePipeline run completed", { runId, inserted, totalProcessed: toProcess.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    LOG("runVeillePipeline failed", { runId, err: msg });
    LOG("runVeillePipeline setting run status to failed");
    await supabase
      .from("veille_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: msg.slice(0, 1000),
      })
      .eq("id", runId);
  }
}
