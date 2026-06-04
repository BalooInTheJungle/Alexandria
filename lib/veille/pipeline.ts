// Veille pipeline orchestrator
// Optimized for Vercel Pro (maxDuration=300s):
//   - Phase 1: parallel RSS fetch (PARALLEL_RSS_CONCURRENCY = 5) → ~16s vs ~77s sequential
//   - Phase 2: cross-source OpenAlex batch (all DOIs in one call) → fewer API calls
//   - Phase 3: insert + score
// Expected daily runtime: ~20s (well within 300s limit)

import { getRssSources, getOpenAlexSources }          from './sources'
import { fetchRssFeed }                                from './fetch-rss'
import { fetchAbstractsByDois, fetchDoiByTitle, fetchRecentByIssn, type AbstractResult } from './openalex'
import { checkFinalizationByDois }                     from './crossref'
import { createRun, completeRun, getKnownDois, insertVeilleItemsWithIds, updateRunPhase, updateVeilleItemBothScores, savePipelineLogs, listVeilleItems, listTodayTopArticles, saveRunSummary, saveItemsAiAnalysis } from '../db/veille'
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

export async function runVeillePipeline(
  existingRunId?: string,
  opts: { dailySummary?: boolean } = {}
): Promise<{ inserted: number; skipped: number; errors: number }> {
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
    const needsDoi: { article: RssArticle; source: RssSource }[] = []
    const freshBySource = new Map<string, RssArticle[]>()
    const rssErrors: string[] = []
    let totalRssExtracted = 0

    for (const source of rssSources) {
      const all = rssResults.get(source.id) ?? []
      const recent = all.filter(a => isRecent(a.published_at))
      const fresh = recent.filter(a => !a.doi || !knownDois.has(a.doi))
      stats.skipped += recent.length - fresh.length
      totalRssExtracted += recent.length
      if (fresh.length === 0) continue
      freshBySource.set(source.id, fresh)
      for (const article of fresh) {
        if (!article.doi && article.abstract) needsDoi.push({ article, source })
      }
    }

    // Collect ALL dois from fresh articles (with or without abstract) for finalization check
    const allFreshDois = new Set<string>()
    Array.from(freshBySource.values()).forEach(articles => {
      articles.forEach(a => { if (a.doi) allFreshDois.add(a.doi) })
    })
    const uniqueDois = Array.from(allFreshDois)
    plog('urls', `${totalRssExtracted} articles RSS extraits — ${uniqueDois.length} DOIs à vérifier via OpenAlex (finalisé + abstract), ${needsDoi.length} titres à résoudre`)
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

    // ── Phase 5a: Identify DOIs needing CrossRef fallback ─────────────────
    // Only DOIs that OpenAlex FOUND but marked not final (biblio lag) → CrossRef
    // DOIs not found in OpenAlex at all → skip (not indexed = too new or preprint)
    const needsCrossRef = new Set<string>()
    for (const doi of uniqueDois) {
      const enriched = abstractMap.get(doi)
      if (enriched && !enriched.is_final) needsCrossRef.add(doi)
    }

    const crossRefMap = needsCrossRef.size > 0
      ? await checkFinalizationByDois(Array.from(needsCrossRef))
      : new Map<string, import('./crossref').CrossRefResult>()

    plog('urls', `CrossRef fallback — ${needsCrossRef.size} DOIs vérifiés, ${Array.from(crossRefMap.values()).filter(r => r.is_final).length} finalisés`)

    // ── Phase 5b: Assemble final items ────────────────────────────────────
    let rssFinalized = 0
    let rssSkippedNotFinal = 0

    for (const source of rssSources) {
      const fresh = freshBySource.get(source.id)
      if (!fresh) continue

      for (const article of fresh) {
        let doi      = article.doi
        let abstract = article.abstract

        if (doi) {
          const openAlex  = abstractMap.get(doi)
          const crossRef  = crossRefMap.get(doi)

          // Enrich abstract from OpenAlex if missing in RSS
          if (openAlex?.abstract && !abstract) abstract = openAlex.abstract

          // Finalization: OpenAlex is_final OR CrossRef confirms it
          const isFinal = openAlex?.is_final || crossRef?.is_final || false

          if (!isFinal) {
            stats.skipped++
            rssSkippedNotFinal++
            continue
          }
          rssFinalized++
        } else {
          // No DOI: resolve via title lookup (Elsevier pattern)
          if (abstract) doi = doiByKey.get(`${source.id}::${article.title}`) ?? null
          else { stats.skipped++; continue }
        }

        if (doi && knownDois.has(doi)) { stats.skipped++; continue }
        if (doi) knownDois.add(doi)

        itemsToInsert.push({
          run_id: runId, source_id: source.id, url: article.url,
          title: article.title, authors: article.authors, doi, abstract,
          published_at: article.published_at, last_error: null,
        })
      }
    }

    plog('urls', `RSS — ${rssFinalized} articles finalisés (volume/pages assignés), ${rssSkippedNotFinal} ignorés (ASAP confirmé OpenAlex + CrossRef)`)

    // ── Phase 6: OpenAlex-only sources (MDPI — no RSS) ────────────────────
    const openAlexSources = await getOpenAlexSources()
    let openAlexExtracted = 0
    let openAlexFinalized = 0
    let openAlexSkippedNotFinal = 0

    for (const source of openAlexSources) {
      const articles = await fetchRecentByIssn(source.issn, LOOKBACK_DAYS)
      openAlexExtracted += articles.length

      // CrossRef fallback for MDPI articles OpenAlex marks as not final
      const notFinalDois = articles
        .filter(a => !a.is_final && a.doi)
        .map(a => a.doi!)
      const mdpiCrossRef = notFinalDois.length > 0
        ? await checkFinalizationByDois(notFinalDois)
        : new Map<string, import('./crossref').CrossRefResult>()

      if (notFinalDois.length > 0) {
        const rescued = Array.from(mdpiCrossRef.values()).filter(r => r.is_final).length
        plog('urls', `CrossRef fallback MDPI ${source.name} — ${notFinalDois.length} vérifiés, ${rescued} récupérés`)
      }

      for (const article of articles) {
        const crossRef = article.doi ? mdpiCrossRef.get(article.doi) : undefined
        const isFinal  = article.is_final || crossRef?.is_final || false
        if (!isFinal) { stats.skipped++; openAlexSkippedNotFinal++; continue }
        if (article.doi && knownDois.has(article.doi)) { stats.skipped++; continue }
        if (article.doi) knownDois.add(article.doi)
        openAlexFinalized++
        itemsToInsert.push({
          run_id: runId, source_id: source.id,
          url: article.doi ? `https://doi.org/${article.doi}` : '',
          title: article.title, authors: article.authors, doi: article.doi,
          abstract: article.abstract, published_at: article.published_at, last_error: null,
        })
      }
      await sleep(OPENALEX_DELAY_MS)
    }

    const grandTotalExtracted = totalRssExtracted + openAlexExtracted
    const grandTotalFinalized = rssFinalized + openAlexFinalized
    plog('urls', `OpenAlex sources — ${openAlexExtracted} extraits, ${openAlexFinalized} finalisés, ${openAlexSkippedNotFinal} ignorés (ASAP)`)
    plog('urls', `TOTAL — ${grandTotalExtracted} articles extraits, ${grandTotalFinalized} rattachés à une publication (${grandTotalExtracted - grandTotalFinalized} ignorés ASAP/non indexés)`)

    // ── Phase 7: Insert ────────────────────────────────────────────────────
    // 300 articles per run × 3 runs/day = ~900 articles/day covered
    // Dedup by DOI ensures no duplicates across runs
    const MAX_ITEMS = 300
    const cappedItems = itemsToInsert.slice(0, MAX_ITEMS)
    if (itemsToInsert.length > MAX_ITEMS) {
      plog('insert', `Cap appliqué : ${itemsToInsert.length} → ${MAX_ITEMS} articles (3 runs/jour couvrent le reste)`, 'warn')
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

    // ── Phase 9: AI summary ───────────────────────────────────────────────
    await updateRunPhase(runId, 'summary')

    const SUMMARY_THRESHOLD = 0.75
    const MAX_FOR_SUMMARY   = 10

    if (opts.dailySummary) {
      // Run 22h — résumé consolidé sur tous les articles du jour (tous runs confondus)
      plog('summary', `Mode résumé quotidien — chargement des articles du jour >= ${SUMMARY_THRESHOLD} — +${elapsed()}s`)
      try {
        const todayItems = await listTodayTopArticles(SUMMARY_THRESHOLD, MAX_FOR_SUMMARY)
        plog('summary', `${todayItems.length} articles du jour éligibles envoyés à GPT — +${elapsed()}s`)

        if (todayItems.length === 0) {
          plog('summary', `Aucun article pertinent aujourd'hui — résumé ignoré — +${elapsed()}s`)
        } else {
          const forSummary = todayItems.map(item => ({
            id:               item.id,
            title:            item.title ?? '',
            abstract:         item.abstract ?? null,
            source_name:      item.source_name,
            similarity_score: item.similarity_score ?? null,
            corpus_refs:      item.corpus_refs ?? [],
          }))
          const { summary, highScoreCount } = await generateVeilleSummary(forSummary, SUMMARY_THRESHOLD)
          await saveRunSummary(runId, { aiSummary: summary, highScoreCount, scoreThreshold: SUMMARY_THRESHOLD })
          plog('summary', `Résumé IA quotidien généré — top ${highScoreCount} articles du jour — +${elapsed()}s`)

          const parsed = parseSummary(summary)
          if (parsed && parsed.articles.length > 0) {
            plog('summary', `Sauvegarde ai_analysis — ${parsed.articles.length} articles — +${elapsed()}s`)
            await saveItemsAiAnalysis(parsed.articles)
            plog('summary', `ai_analysis sauvegardé pour ${parsed.articles.length} articles — +${elapsed()}s`)
          }
        }
      } catch (err: any) {
        plog('summary', `Échec résumé IA quotidien : ${err.message}`, 'error')
      }
    } else {
      // Run 6h / 14h — pas de résumé IA, on laisse le run 22h consolider
      const eligibleCount = Array.from(bothScores.values()).filter(s => (s.similarity ?? 0) >= SUMMARY_THRESHOLD).length
      plog('summary', `Run intermédiaire — ${eligibleCount} articles >= ${SUMMARY_THRESHOLD} (résumé IA réservé au run 22h) — +${elapsed()}s`)
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
