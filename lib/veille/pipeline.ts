// Veille pipeline orchestrator
// Optimized for Vercel Pro (maxDuration=300s):
//   - Phase 1: parallel RSS fetch (PARALLEL_RSS_CONCURRENCY = 5) → ~16s vs ~77s sequential
//   - Phase 2: cross-source OpenAlex batch (all DOIs in one call) → fewer API calls
//   - Phase 3: insert + score
// Expected daily runtime: ~20s (well within 300s limit)

import { getRssSources, getOpenAlexSources }          from './sources'
import { fetchRssFeed }                                from './fetch-rss'
import { fetchAbstractsByDois, fetchDoiByTitle, fetchRecentByIssn, type AbstractResult } from './openalex'
import { createRun, completeRun, getKnownDois, insertVeilleItemsWithIds, updateRunPhase, updateVeilleItemBothScores, savePipelineLogs, listVeilleItems, saveRunSummary, saveItemsAiAnalysis } from '../db/veille'
import type { RunLogEntry, RunLogLevel } from '../db/types'
import { scoreVeilleItems, loadCorpusTerms, scoreHeuristic } from './score'
import { generateVeilleSummary, parseSummary } from './summarize'
import type { VeilleItemInsert }                       from '../db/veille'
import type { RssSource, RssArticle }                  from './fetch-rss'

const LOOKBACK_DAYS = 7
const PARALLEL_RSS_CONCURRENCY = 5  // simultaneous RSS fetches — stay polite
const OPENALEX_DELAY_MS = 300       // delay between individual OpenAlex calls

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function isRecent(published_at: string | null): boolean {
  if (!published_at) return true
  return Date.now() - new Date(published_at).getTime() < LOOKBACK_DAYS * 86400000
}

// Fetch all RSS sources in parallel batches of PARALLEL_RSS_CONCURRENCY
// 43 sources / 5 = 9 batches × ~1.5s = ~16s (vs ~77s sequential)
async function fetchRssInParallel(sources: RssSource[]): Promise<Map<string, RssArticle[]>> {
  const results = new Map<string, RssArticle[]>()

  for (let i = 0; i < sources.length; i += PARALLEL_RSS_CONCURRENCY) {
    const batch = sources.slice(i, i + PARALLEL_RSS_CONCURRENCY)
    const fetched = await Promise.all(batch.map(s => fetchRssFeed(s)))
    batch.forEach((s, j) => results.set(s.id, fetched[j]))
    if (i + PARALLEL_RSS_CONCURRENCY < sources.length) await sleep(300)
  }

  return results
}

export async function runVeillePipeline(existingRunId?: string): Promise<{ inserted: number; skipped: number; errors: number }> {
  const pipelineStart = Date.now()
  console.log(`[pipeline] Starting (lookback=${LOOKBACK_DAYS}d, rss_concurrency=${PARALLEL_RSS_CONCURRENCY})`)
  const runId = existingRunId ?? await createRun()
  const stats = { inserted: 0, skipped: 0, errors: 0 }

  const logs: RunLogEntry[] = []
  const elapsed = () => Math.round((Date.now() - pipelineStart) / 1000)
  function plog(phase: string, msg: string, level: RunLogLevel = 'info') {
    console.log(`[pipeline/${phase}] ${msg}`)
    logs.push({ ts: new Date().toISOString(), level, phase, msg })
  }

  try {
    const knownDois = await getKnownDois()
    const itemsToInsert: VeilleItemInsert[] = []

    // ── Phase 1: Fetch all RSS in parallel ────────────────────────────────
    await updateRunPhase(runId, 'sources')
    const rssSources = await getRssSources()
    plog('sources', `Fetching ${rssSources.length} sources RSS en parallèle`)
    const rssResults = await fetchRssInParallel(rssSources)

    // ── Phase 2: Filter + dedup + collect enrichment needs ────────────────
    await updateRunPhase(runId, 'urls')
    const needsAbstract: { doi: string }[] = []
    const needsDoi: { article: RssArticle; source: RssSource }[] = []
    const freshBySource = new Map<string, RssArticle[]>()
    const rssErrors: string[] = []

    for (const source of rssSources) {
      const all = rssResults.get(source.id) ?? []
      const recent = all.filter(a => isRecent(a.published_at))
      const fresh = recent.filter(a => !a.doi || !knownDois.has(a.doi))
      stats.skipped += recent.length - fresh.length
      if (fresh.length === 0) continue
      freshBySource.set(source.id, fresh)
      for (const article of fresh) {
        if (article.doi && !article.abstract)  needsAbstract.push({ doi: article.doi })
        if (!article.doi && article.abstract)  needsDoi.push({ article, source })
      }
    }

    const uniqueDois = Array.from(new Set(needsAbstract.map(x => x.doi)))
    plog('urls', `${uniqueDois.length} DOIs à enrichir via OpenAlex, ${needsDoi.length} titres à résoudre`)
    if (rssErrors.length > 0) plog('sources', `Erreurs RSS : ${rssErrors.join(', ')}`, 'warn')

    // ── Phase 3: Cross-source batch abstract fetch ─────────────────────────
    const abstractMap = uniqueDois.length > 0
      ? await fetchAbstractsByDois(uniqueDois)
      : new Map<string, AbstractResult>()

    // ── Phase 4: Individual DOI lookup (Elsevier pattern — few articles/day)
    const doiByKey = new Map<string, string | null>()
    for (const { article, source } of needsDoi) {
      const doi = await fetchDoiByTitle(article.title, source.issn)
      doiByKey.set(`${source.id}::${article.title}`, doi)
      await sleep(OPENALEX_DELAY_MS)
    }

    // ── Phase 5: Assemble final items ──────────────────────────────────────
    for (const source of rssSources) {
      const fresh = freshBySource.get(source.id)
      if (!fresh) continue

      for (const article of fresh) {
        let doi      = article.doi
        let abstract = article.abstract

        if (doi && !abstract) {
          const enriched = abstractMap.get(doi)
          if (enriched) {
            abstract = enriched.abstract
            if (!enriched.is_final) { stats.skipped++; continue }
          }
        }
        if (!doi && abstract)  doi = doiByKey.get(`${source.id}::${article.title}`) ?? null

        if (doi && knownDois.has(doi)) { stats.skipped++; continue }
        if (doi) knownDois.add(doi)

        itemsToInsert.push({
          run_id: runId, source_id: source.id, url: article.url,
          title: article.title, authors: article.authors, doi, abstract,
          published_at: article.published_at, last_error: null,
        })
      }
    }

    // ── Phase 6: OpenAlex-only sources (MDPI — no RSS) ────────────────────
    const openAlexSources = await getOpenAlexSources()
    for (const source of openAlexSources) {
      const articles = await fetchRecentByIssn(source.issn, LOOKBACK_DAYS)
      for (const article of articles) {
        if (!article.is_final) { stats.skipped++; continue }
        if (article.doi && knownDois.has(article.doi)) { stats.skipped++; continue }
        if (article.doi) knownDois.add(article.doi)
        itemsToInsert.push({
          run_id: runId, source_id: source.id,
          url: article.doi ? `https://doi.org/${article.doi}` : '',
          title: article.title, authors: article.authors, doi: article.doi,
          abstract: article.abstract, published_at: article.published_at, last_error: null,
        })
      }
      await sleep(OPENALEX_DELAY_MS)
    }

    // ── Phase 7: Insert ────────────────────────────────────────────────────
    const MAX_ITEMS = 1000
    const cappedItems = itemsToInsert.slice(0, MAX_ITEMS)
    if (itemsToInsert.length > MAX_ITEMS) {
      plog('insert', `Cap appliqué : ${itemsToInsert.length} → ${MAX_ITEMS} articles`, 'warn')
    }
    await updateRunPhase(runId, 'items', 0, cappedItems.length)
    plog('insert', `Insertion de ${cappedItems.length} articles (${stats.skipped} déjà connus)`)
    const insertedIds = await insertVeilleItemsWithIds(cappedItems)
    stats.inserted = insertedIds.length
    plog('insert', `${insertedIds.length} articles insérés en base — +${elapsed()}s`)

    // ── Phase 8: Score against corpus (similarity + heuristic + corpus_refs) ─
    const bothScores = new Map<string, { similarity: number | null; heuristic: number | null; refs: import('../db/types').CorpusRef[] }>()

    if (insertedIds.length > 0) {
      const corpusTerms = await loadCorpusTerms(80)
      const toScore = insertedIds.map(item => ({ id: item.id, abstract: item.abstract }))

      plog('scoring', `Scoring de ${toScore.length} articles (similarité corpus + heuristique) — +${elapsed()}s`)
      const simScores = await scoreVeilleItems(toScore, async (done, total) => {
        await updateRunPhase(runId, 'items', done, total)
      })

      let timeouts = 0
      for (const { id, abstract } of toScore) {
        const result     = simScores.get(id)
        const similarity = result?.similarity ?? null
        const refs       = result?.refs ?? []
        const heuristic  = abstract && abstract.length > 50 && corpusTerms.length > 0
          ? scoreHeuristic(abstract, corpusTerms) : null
        bothScores.set(id, { similarity, heuristic, refs })
        if (similarity === null) timeouts++
      }

      await updateVeilleItemBothScores(bothScores)
      await updateRunPhase(runId, 'items', toScore.length, toScore.length)

      const scored = toScore.length - timeouts
      if (timeouts > 0) {
        plog('scoring', `${timeouts}/${toScore.length} articles en timeout match_chunks (similarity=null)`, 'warn')
      }
      plog('scoring', `Scoring terminé — ${scored} scorés, +${elapsed()}s`)
    }

    // ── Phase 9: AI summary of top articles ───────────────────────────────
    await updateRunPhase(runId, 'summary')

    const THRESHOLD = 0.75
    const eligibleCount = Array.from(bothScores.values()).filter(s => (s.similarity ?? 0) >= THRESHOLD).length
    plog('summary', `${eligibleCount} articles >= ${THRESHOLD} éligibles — appel route dédiée — +${elapsed()}s`)

    // Generate AI summary directly in the pipeline
    try {
      const SUMMARY_THRESHOLD = 0.75
      const MAX_FOR_SUMMARY   = 10
      const items = await listVeilleItems({ runId, limit: 1000 })
      const eligible = items
        .filter(i => (i.similarity_score ?? 0) >= SUMMARY_THRESHOLD)
        .slice(0, MAX_FOR_SUMMARY)

      plog('summary', `${eligible.length} articles éligibles envoyés à GPT — +${elapsed()}s`)

      const forSummary = eligible.map(item => ({
        id:               item.id,
        title:            item.title ?? '',
        abstract:         item.abstract ?? null,
        source_name:      item.source_name,
        similarity_score: item.similarity_score ?? null,
        corpus_refs:      item.corpus_refs ?? [],
      }))

      const { summary, highScoreCount } = await generateVeilleSummary(forSummary, SUMMARY_THRESHOLD)
      await saveRunSummary(runId, { aiSummary: summary, highScoreCount, scoreThreshold: SUMMARY_THRESHOLD })
      plog('summary', `Résumé IA généré — top ${highScoreCount} articles — +${elapsed()}s`)

      // Backfill ai_analysis on each analyzed item
      const parsed = parseSummary(summary)
      if (parsed && parsed.articles.length > 0) {
        await saveItemsAiAnalysis(parsed.articles)
        plog('summary', `ai_analysis sauvegardé pour ${parsed.articles.length} articles — +${elapsed()}s`)
      }
    } catch (err: any) {
      plog('summary', `Échec résumé IA : ${err.message}`, 'error')
    }

    await updateRunPhase(runId, 'done')
    plog('done', `Pipeline terminé — inséré=${stats.inserted} ignoré=${stats.skipped} erreurs=${stats.errors} — +${elapsed()}s`)
    await savePipelineLogs(runId, logs)
    await completeRun(runId, 'completed')

  } catch (err: any) {
    plog('fatal', `Erreur fatale : ${err.message}`, 'error')
    stats.errors++
    await savePipelineLogs(runId, logs).catch(() => {})
    await completeRun(runId, 'failed', err.message)
  }

  return stats
}
