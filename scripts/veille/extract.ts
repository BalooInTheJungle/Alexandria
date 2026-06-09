#!/usr/bin/env ts-node
/**
 * scripts/veille/extract.ts — Job 1 : extraction + filtre garde-fou
 *
 * Fetch RSS + OpenAlex, applique les filtres (finalisé + abstract requis),
 * insère dans veille_items. Sauvegarde les logs dans veille_runs.pipeline_logs.
 *
 * Usage : npx ts-node --project tsconfig.scripts.json scripts/veille/extract.ts
 * Sortie stdout : run_id (UNIQUEMENT — lu par GitHub Actions pour passer aux jobs suivants)
 * Sortie stderr : logs lisibles
 *
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   EXISTING_RUN_ID              — (optionnel) reprendre un run existant
 */

import { createClient } from '@supabase/supabase-js'
import { getRssSources, getOpenAlexSources } from '../../lib/veille/sources'
import { fetchRssFeed } from '../../lib/veille/fetch-rss'
import {
  fetchAbstractsByDois,
  fetchDoiByTitle,
  fetchRecentByIssn,
  type AbstractResult,
} from '../../lib/veille/openalex'
import { checkFinalizationByDois } from '../../lib/veille/crossref'
import type { VeilleItemInsert } from '../../lib/db/veille'
import type { RssSource, RssArticle } from '../../lib/veille/fetch-rss'
import type { RunLogEntry, RunLogLevel } from '../../lib/db/types'

// ── Config ────────────────────────────────────────────────────────────────────

const LOOKBACK_DAYS            = 7
const PARALLEL_RSS_CONCURRENCY = 5
const OPENALEX_DELAY_MS        = 300

// ── DB admin client (pas de dépendance Next.js) ────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[extract] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
  return createClient(url, key)
}

// ── Logging — stderr pour les logs, stdout réservé au run_id ─────────────────

const scriptStart = Date.now()
const elapsed = () => `+${Math.round((Date.now() - scriptStart) / 1000)}s`

const collectedLogs: RunLogEntry[] = []

function log(phase: string, msg: string, level: RunLogLevel = 'info') {
  const ts = new Date().toISOString()
  const line = `[extract/${phase}] ${elapsed()} ${msg}`
  if (level === 'error') process.stderr.write(`❌ ${line}\n`)
  else if (level === 'warn') process.stderr.write(`⚠️  ${line}\n`)
  else process.stderr.write(`   ${line}\n`)
  collectedLogs.push({ ts, level, phase, msg })
}

// ── DB helpers (admin, sans @/ alias) ────────────────────────────────────────

async function createRun(): Promise<string> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('veille_runs')
    .insert({ status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()
  if (error) throw new Error(`createRun failed: ${error.message}`)
  return data.id
}

async function updatePhase(
  runId: string,
  phase: string,
  processed?: number,
  total?: number
) {
  const sb = getSupabase()
  const patch: Record<string, unknown> = { phase }
  if (processed !== undefined) patch.items_processed = processed
  if (total !== undefined)     patch.items_total     = total
  await sb.from('veille_runs').update(patch).eq('id', runId)
}

async function saveLogs(runId: string, logs: RunLogEntry[]) {
  if (logs.length === 0) return
  const sb = getSupabase()
  await sb.from('veille_runs').update({ pipeline_logs: logs }).eq('id', runId)
}

async function completeRun(runId: string, status: 'completed' | 'failed', errorMsg?: string) {
  const sb = getSupabase()
  await sb
    .from('veille_runs')
    .update({ status, completed_at: new Date().toISOString(), error_message: errorMsg ?? null })
    .eq('id', runId)
}

async function getKnownDois(): Promise<Set<string>> {
  const sb = getSupabase()
  const timeout = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error('getKnownDois timeout 20s')), 20_000)
  )
  const query = sb
    .from('veille_items')
    .select('doi')
    .not('doi', 'is', null)
    .limit(100_000)
    .then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return data
    })
  try {
    const data = await Promise.race([query, timeout])
    if (!data) return new Set()
    const dois = new Set(data.map((r: any) => r.doi as string))
    log('dedup', `${dois.size} DOIs connus chargés`)
    return dois
  } catch (err: any) {
    log('dedup', `getKnownDois échoué — dédup désactivé : ${err.message}`, 'warn')
    return new Set()
  }
}

async function insertItems(
  items: VeilleItemInsert[]
): Promise<{ id: string; abstract: string | null }[]> {
  if (items.length === 0) return []
  const sb = getSupabase()
  const inserted: { id: string; abstract: string | null }[] = []
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50)
    const { data, error } = await sb
      .from('veille_items')
      .upsert(batch, { onConflict: 'doi', ignoreDuplicates: true })
      .select('id, abstract')
    if (error) log('insert', `Erreur batch ${i}: ${error.message}`, 'error')
    else inserted.push(...(data ?? []))
    log('insert', `Batch ${Math.floor(i / 50) + 1} — ${(data ?? []).length} insérés`)
  }
  return inserted
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function isRecent(published_at: string | null): boolean {
  if (!published_at) return true
  return Date.now() - new Date(published_at).getTime() < LOOKBACK_DAYS * 86_400_000
}

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

// ── Pipeline extraction ───────────────────────────────────────────────────────

async function runExtraction(): Promise<string> {
  const existingRunId = process.env.EXISTING_RUN_ID?.trim()

  // Crée ou réutilise un run
  const runId = existingRunId || await createRun()
  const isResume = !!existingRunId

  process.stderr.write(`\n🚀 [extract] Démarrage — run_id=${runId}${isResume ? ' (reprise)' : ''}\n\n`)

  try {
    // ── Phase 1 : Sources RSS ────────────────────────────────────────────────
    await updatePhase(runId, 'sources')
    const knownDois = await getKnownDois()
    const rssSources = await getRssSources()
    log('sources', `${rssSources.length} sources RSS chargées`)

    const rssResults = await fetchRssInParallel(rssSources)
    log('sources', `Fetch RSS parallèle terminé (concurrence=${PARALLEL_RSS_CONCURRENCY})`)

    // ── Phase 2 : Filtre date + dédup ────────────────────────────────────────
    await updatePhase(runId, 'filter')
    const freshBySource = new Map<string, RssArticle[]>()
    const needsDoi: { article: RssArticle; source: RssSource }[] = []
    let totalExtracted = 0
    let totalSkippedKnown = 0

    for (const source of rssSources) {
      const all    = rssResults.get(source.id) ?? []
      const recent = all.filter(a => isRecent(a.published_at))
      const fresh  = recent.filter(a => !a.doi || !knownDois.has(a.doi))
      totalExtracted   += recent.length
      totalSkippedKnown += recent.length - fresh.length
      if (fresh.length === 0) continue
      freshBySource.set(source.id, fresh)
      for (const article of fresh) {
        if (!article.doi && article.abstract) needsDoi.push({ article, source })
      }
    }

    const allFreshDois = new Set<string>()
    Array.from(freshBySource.values()).forEach(arts => arts.forEach(a => { if (a.doi) allFreshDois.add(a.doi) }))
    const uniqueDois = Array.from(allFreshDois)

    log('filter', `${totalExtracted} articles récents — ${totalSkippedKnown} déjà connus — ${uniqueDois.length} DOIs à vérifier`)

    // ── Phase 3 : OpenAlex — abstracts en batch ──────────────────────────────
    await updatePhase(runId, 'openalex')
    const abstractMap = uniqueDois.length > 0
      ? await fetchAbstractsByDois(uniqueDois)
      : new Map<string, AbstractResult>()
    log('openalex', `${abstractMap.size} abstracts récupérés via OpenAlex batch`)

    // ── Phase 4 : OpenAlex — résolution DOI par titre (Elsevier) ─────────────
    const doiByKey = new Map<string, string | null>()
    if (needsDoi.length > 0) {
      log('openalex', `Résolution DOI par titre — ${needsDoi.length} articles`)
      for (const { article, source } of needsDoi) {
        const doi = await fetchDoiByTitle(article.title, source.issn)
        doiByKey.set(`${source.id}::${article.title}`, doi)
        await sleep(OPENALEX_DELAY_MS)
      }
    }

    // ── Phase 5a : CrossRef fallback (finalisé non confirmé par OpenAlex) ────
    const needsCrossRef = new Set<string>()
    for (const doi of uniqueDois) {
      const enriched = abstractMap.get(doi)
      if (enriched && !enriched.is_final) needsCrossRef.add(doi)
    }
    const crossRefMap = needsCrossRef.size > 0
      ? await checkFinalizationByDois(Array.from(needsCrossRef))
      : new Map<string, import('../../lib/veille/crossref').CrossRefResult>()
    const crossRefRescued = Array.from(crossRefMap.values()).filter(r => r.is_final).length
    log('crossref', `CrossRef fallback — ${needsCrossRef.size} vérifiés, ${crossRefRescued} récupérés`)

    // ── Phase 5b : Assemblage articles RSS finalisés ──────────────────────────
    const itemsToInsert: VeilleItemInsert[] = []
    let rssFinalized = 0
    let rssSkipped   = 0

    for (const source of rssSources) {
      const fresh = freshBySource.get(source.id)
      if (!fresh) continue

      for (const article of fresh) {
        let doi      = article.doi
        let abstract = article.abstract

        if (doi) {
          const openAlex = abstractMap.get(doi)
          const crossRef = crossRefMap.get(doi)
          if (openAlex?.abstract && !abstract) abstract = openAlex.abstract
          const isFinal = openAlex?.is_final || crossRef?.is_final || false
          if (!isFinal) { rssSkipped++; continue }
          rssFinalized++
        } else {
          if (abstract) doi = doiByKey.get(`${source.id}::${article.title}`) ?? null
          else { rssSkipped++; continue }
        }

        if (!abstract) { rssSkipped++; continue }
        if (doi && knownDois.has(doi)) { rssSkipped++; continue }
        if (doi) knownDois.add(doi)

        itemsToInsert.push({
          run_id: runId, source_id: source.id, url: article.url,
          title: article.title, authors: article.authors, doi, abstract,
          published_at: article.published_at, last_error: null,
        })
      }
    }

    log('filter', `RSS — ${rssFinalized} finalisés, ${rssSkipped} ignorés (ASAP / sans abstract / doublon)`)

    // ── Phase 6 : Sources OpenAlex uniquement (MDPI…) ────────────────────────
    const openAlexSources = await getOpenAlexSources()
    let oaExtracted  = 0
    let oaFinalized  = 0
    let oaSkipped    = 0

    for (const source of openAlexSources) {
      const articles = await fetchRecentByIssn(source.issn, LOOKBACK_DAYS)
      oaExtracted += articles.length

      const notFinalDois = articles.filter(a => !a.is_final && a.doi).map(a => a.doi!)
      const mdpiCrossRef = notFinalDois.length > 0
        ? await checkFinalizationByDois(notFinalDois)
        : new Map<string, import('../../lib/veille/crossref').CrossRefResult>()

      if (notFinalDois.length > 0) {
        const rescued = Array.from(mdpiCrossRef.values()).filter(r => r.is_final).length
        log('openalex', `CrossRef MDPI ${source.name} — ${notFinalDois.length} vérifiés, ${rescued} récupérés`)
      }

      for (const article of articles) {
        const crossRef = article.doi ? mdpiCrossRef.get(article.doi) : undefined
        const isFinal  = article.is_final || crossRef?.is_final || false
        if (!isFinal) { oaSkipped++; continue }
        if (!article.abstract) { oaSkipped++; continue }
        if (article.doi && knownDois.has(article.doi)) { oaSkipped++; continue }
        if (article.doi) knownDois.add(article.doi)
        oaFinalized++
        itemsToInsert.push({
          run_id: runId, source_id: source.id,
          url: article.doi ? `https://doi.org/${article.doi}` : '',
          title: article.title, authors: article.authors, doi: article.doi,
          abstract: article.abstract, published_at: article.published_at, last_error: null,
        })
      }
      await sleep(OPENALEX_DELAY_MS)
    }

    log('openalex', `OpenAlex sources — ${oaExtracted} extraits, ${oaFinalized} finalisés, ${oaSkipped} ignorés`)
    log('filter', `TOTAL — ${itemsToInsert.length} articles à insérer (RSS: ${rssFinalized} + OpenAlex: ${oaFinalized})`)

    // ── Phase 7 : Insertion en DB ────────────────────────────────────────────
    await updatePhase(runId, 'insert', 0, itemsToInsert.length)
    const inserted = await insertItems(itemsToInsert)
    log('insert', `${inserted.length}/${itemsToInsert.length} insérés (${itemsToInsert.length - inserted.length} ignorés — DOI déjà connu)`)
    await updatePhase(runId, 'extracted', inserted.length, itemsToInsert.length)

    // ── Fin extraction — marquer "extracted" (prêt pour scoring) ─────────────
    await saveLogs(runId, collectedLogs)
    // Ne pas marquer "completed" ici — le run sera complété par recap-global
    process.stderr.write(`\n✅ [extract] Terminé — ${inserted.length} articles insérés — run_id=${runId}\n\n`)

    return runId

  } catch (err: any) {
    log('fatal', `Erreur fatale : ${err.message}`, 'error')
    await saveLogs(runId, collectedLogs).catch(() => {})
    await completeRun(runId, 'failed', err.message)
    throw err
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

runExtraction()
  .then(runId => {
    // STDOUT = run_id uniquement (capturé par GitHub Actions)
    process.stdout.write(runId + '\n')
    process.exit(0)
  })
  .catch(err => {
    process.stderr.write(`[extract] FATAL: ${err.message}\n`)
    process.exit(1)
  })
