// Veille pipeline orchestrator
// Optimized for Vercel Pro (maxDuration=300s):
//   - Phase 1: parallel RSS fetch (PARALLEL_RSS_CONCURRENCY = 5) → ~16s vs ~77s sequential
//   - Phase 2: cross-source OpenAlex batch (all DOIs in one call) → fewer API calls
//   - Phase 3: insert + score
// Expected daily runtime: ~20s (well within 300s limit)

import { getRssSources, getOpenAlexSources }          from './sources'
import { fetchRssFeed }                                from './fetch-rss'
import { fetchAbstractsByDois, fetchDoiByTitle, fetchRecentByIssn, type AbstractResult } from './openalex'
import { createRun, completeRun, getKnownDois, insertVeilleItemsWithIds, updateRunPhase, updateVeilleItemBothScores, saveRunSummary } from '../db/veille'
import { scoreVeilleItems, loadCorpusTerms, scoreHeuristic } from './score'
import { generateVeilleSummary } from './summarize'
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
  console.log(`[pipeline] Starting (lookback=${LOOKBACK_DAYS}d, rss_concurrency=${PARALLEL_RSS_CONCURRENCY})`)
  const runId = existingRunId ?? await createRun()
  const stats = { inserted: 0, skipped: 0, errors: 0 }

  try {
    const knownDois = await getKnownDois()
    const itemsToInsert: VeilleItemInsert[] = []

    // ── Phase 1: Fetch all RSS in parallel ────────────────────────────────
    await updateRunPhase(runId, 'sources')
    const rssSources = await getRssSources()
    console.log(`[pipeline] Fetching ${rssSources.length} RSS sources in parallel (${PARALLEL_RSS_CONCURRENCY} concurrent)`)
    const rssResults = await fetchRssInParallel(rssSources)

    // ── Phase 2: Filter + dedup + collect enrichment needs ────────────────
    await updateRunPhase(runId, 'urls')
    // Cross-source: collect all DOIs needing abstract across ALL sources before fetching
    const needsAbstract: { doi: string }[] = []
    const needsDoi: { article: RssArticle; source: RssSource }[] = []
    const freshBySource = new Map<string, RssArticle[]>()

    for (const source of rssSources) {
      const all = rssResults.get(source.id) ?? []
      const recent = all.filter(a => isRecent(a.published_at))
      const skipped = all.length - recent.length
      if (skipped > 0) console.log(`[pipeline] ${source.name}: ${skipped} articles older than ${LOOKBACK_DAYS}d — skipped`)

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
    console.log(`[pipeline] Enrichment: ${uniqueDois.length} unique DOIs need abstract, ${needsDoi.length} articles need DOI`)

    // ── Phase 3: Cross-source batch abstract fetch ─────────────────────────
    // All sources combined → 1 batch call per 50 DOIs instead of N per-source calls
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
            // Skip non-journal articles detected by OpenAlex (preprints, book chapters, etc.)
            if (!enriched.is_final) {
              console.log(`[pipeline] Skipping non-journal article (OpenAlex type): ${doi}`)
              stats.skipped++
              continue
            }
          }
        }
        if (!doi && abstract)  doi = doiByKey.get(`${source.id}::${article.title}`) ?? null

        // Post-enrichment dedup (DOI resolved after lookup)
        if (doi && knownDois.has(doi)) { stats.skipped++; continue }
        if (doi) knownDois.add(doi)

        itemsToInsert.push({
          run_id:       runId,
          source_id:    source.id,
          url:          article.url,
          title:        article.title,
          authors:      article.authors,
          doi,
          abstract,
          published_at: article.published_at,
          last_error:   null,
        })
      }
    }

    // ── Phase 6: OpenAlex-only sources (MDPI — no RSS) ────────────────────
    const openAlexSources = await getOpenAlexSources()
    console.log(`[pipeline] Processing ${openAlexSources.length} OpenAlex-only sources`)

    for (const source of openAlexSources) {
      const articles = await fetchRecentByIssn(source.issn, LOOKBACK_DAYS)

      for (const article of articles) {
        // Skip non-journal articles (preprints, book chapters, proceedings…)
        if (!article.is_final) {
          console.log(`[pipeline] Skipping non-journal article (OpenAlex type): ${article.doi ?? article.title.slice(0, 40)}`)
          stats.skipped++
          continue
        }
        if (article.doi && knownDois.has(article.doi)) { stats.skipped++; continue }
        if (article.doi) knownDois.add(article.doi)

        itemsToInsert.push({
          run_id:       runId,
          source_id:    source.id,
          url:          article.doi ? `https://doi.org/${article.doi}` : '',
          title:        article.title,
          authors:      article.authors,
          doi:          article.doi,
          abstract:     article.abstract,
          published_at: article.published_at,
          last_error:   null,
        })
      }

      await sleep(OPENALEX_DELAY_MS)
    }

    // ── Phase 7: Insert ────────────────────────────────────────────────────
    await updateRunPhase(runId, 'items', 0, itemsToInsert.length)
    console.log(`[pipeline] Inserting ${itemsToInsert.length} items`)
    const insertedIds = await insertVeilleItemsWithIds(itemsToInsert)
    stats.inserted = insertedIds.length

    // ── Phase 8: Score against corpus (similarity + heuristic + corpus_refs) ─
    const bothScores = new Map<string, { similarity: number | null; heuristic: number | null; refs: import('../db/types').CorpusRef[] }>()

    if (insertedIds.length > 0) {
      console.log('[pipeline] Loading corpus terms for heuristic scoring')
      const corpusTerms = await loadCorpusTerms(80)

      console.log('[pipeline] Scoring abstracts against corpus')
      const toScore  = insertedIds.map(item => ({ id: item.id, abstract: item.abstract }))
      const simScores = await scoreVeilleItems(toScore, async (done, total) => {
        await updateRunPhase(runId, 'items', done, total)
        console.log(`[pipeline] scoring progress ${done}/${total}`)
      })

      for (const { id, abstract } of toScore) {
        const result     = simScores.get(id)
        const similarity = result?.similarity ?? null
        const refs       = result?.refs ?? []
        const heuristic  = abstract && abstract.length > 50 && corpusTerms.length > 0
          ? scoreHeuristic(abstract, corpusTerms)
          : null
        bothScores.set(id, { similarity, heuristic, refs })
      }

      await updateVeilleItemBothScores(bothScores)
      await updateRunPhase(runId, 'items', toScore.length, toScore.length)
    }

    // ── Phase 9: AI summary of top articles ───────────────────────────────
    await updateRunPhase(runId, 'summary')

    // Build source lookup for summary context
    const sourceMap = new Map<string, string>()
    for (const s of [...rssSources, ...openAlexSources]) sourceMap.set(s.id, s.name)

    // Pair inserted items with their titles (itemsToInsert is in same insertion order)
    const scoredForSummary = insertedIds.map((item, idx) => ({
      id:               item.id,
      title:            itemsToInsert[idx]?.title ?? '',
      abstract:         item.abstract,
      source_name:      sourceMap.get(itemsToInsert[idx]?.source_id ?? '') ?? null,
      similarity_score: bothScores.get(item.id)?.similarity ?? null,
      corpus_refs:      bothScores.get(item.id)?.refs ?? [],
    }))

    console.log('[pipeline] Generating AI summary')
    try {
      const THRESHOLD = 0.75
      const { summary, highScoreCount } = await generateVeilleSummary(scoredForSummary, THRESHOLD)
      await saveRunSummary(runId, { aiSummary: summary, highScoreCount, scoreThreshold: THRESHOLD })
      console.log(`[pipeline] AI summary saved — ${highScoreCount} articles >= ${THRESHOLD}`)
    } catch (err: any) {
      console.error('[pipeline] AI summary failed (non-fatal):', err.message)
    }

    await updateRunPhase(runId, 'done')
    await completeRun(runId, 'completed')
    console.log(`[pipeline] Done — inserted=${stats.inserted} skipped=${stats.skipped} errors=${stats.errors}`)

  } catch (err: any) {
    console.error('[pipeline] Fatal error:', err.message)
    stats.errors++
    await completeRun(runId, 'failed', err.message)
  }

  return stats
}
