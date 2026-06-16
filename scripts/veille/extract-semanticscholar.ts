#!/usr/bin/env ts-node
/**
 * scripts/veille/extract-semanticscholar.ts — Job 1b : Semantic Scholar Recommendations
 *
 * Stratégie :
 *   1. Calcule le centroïde des embeddings des chunks auteur (RPC Supabase)
 *   2. Trouve les N articles auteur les plus proches de ce centroïde
 *   3. Recherche leurs paperIds sur l'API SS (par titre)
 *   4. Appelle SS recommendations → articles récents similaires
 *   5. Insère dans veille_items (dédup DOI)
 *
 * Usage : npx tsx scripts/veille/extract-semanticscholar.ts
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   RUN_ID                       — run_id créé par extract.ts (Job 1)
 *   SS_MAX_RECOMMENDATIONS       — (optionnel) nombre max de recommandations (défaut: 100)
 *   SS_REPRESENTATIVE_TITLES     — (optionnel) nombre de titres représentatifs (défaut: 15)
 */

import { createClient } from '@supabase/supabase-js'
import type { VeilleItemInsert } from '../../lib/db/veille'
import type { RunLogEntry, RunLogLevel } from '../../lib/db/types'

// ── Config ────────────────────────────────────────────────────────────────────

const SS_SEARCH_URL    = 'https://api.semanticscholar.org/graph/v1/paper/search'
const SS_RECS_URL      = 'https://api.semanticscholar.org/recommendations/v1/papers/'
const SS_FIELDS        = 'paperId,title,authors,year,publicationDate,externalIds,abstract,url,venue'
const MAX_RECS         = parseInt(process.env.SS_MAX_RECOMMENDATIONS ?? '100', 10)
const TOP_TITLES       = parseInt(process.env.SS_REPRESENTATIVE_TITLES ?? '15', 10)
const SS_DELAY_MS      = 500 // délai entre appels API pour éviter rate limit

// ── DB ────────────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[extract-ss] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
  return createClient(url, key)
}

// ── Logging ───────────────────────────────────────────────────────────────────

const scriptStart    = Date.now()
const elapsed        = () => `+${Math.round((Date.now() - scriptStart) / 1000)}s`
const collectedLogs: RunLogEntry[] = []

function log(phase: string, msg: string, level: RunLogLevel = 'info') {
  const ts   = new Date().toISOString()
  const line = `[extract-ss/${phase}] ${elapsed()} ${msg}`
  if (level === 'error') process.stderr.write(`❌ ${line}\n`)
  else if (level === 'warn') process.stderr.write(`⚠️  ${line}\n`)
  else process.stderr.write(`   ${line}\n`)
  collectedLogs.push({ ts, level, phase: `ss/${phase}`, msg })
}

async function appendLogs(runId: string) {
  if (collectedLogs.length === 0) return
  const sb = getSupabase()
  const { data } = await sb.from('veille_runs').select('pipeline_logs').eq('id', runId).single()
  const existing: RunLogEntry[] = (data?.pipeline_logs as RunLogEntry[]) ?? []
  await sb.from('veille_runs').update({ pipeline_logs: [...existing, ...collectedLogs] }).eq('id', runId)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Étape 1 : titres représentatifs via centroïde ────────────────────────────

async function loadRepresentativeTitles(): Promise<string[]> {
  const sb = getSupabase()
  log('centroid', `Calcul du centroïde des chunks auteur, top ${TOP_TITLES} titres…`)

  const { data, error } = await sb
    .rpc('get_author_representative_titles', { top_n: TOP_TITLES })

  if (error) throw new Error(`get_author_representative_titles: ${error.message}`)

  const titles = (data as { title: string; distance: number }[])
    .map(r => r.title)
    .filter(t => t && t.length > 20)

  log('centroid', `${titles.length} titres représentatifs trouvés`)
  titles.forEach((t, i) => log('centroid', `  #${i + 1} ${t.slice(0, 80)}`))
  return titles
}

// ── Étape 2 : résolution titre → paperId SS ──────────────────────────────────

async function resolvePaperId(title: string): Promise<string | null> {
  const url = `${SS_SEARCH_URL}?query=${encodeURIComponent(title)}&limit=1&fields=paperId,title`
  const res  = await fetch(url)
  if (!res.ok) {
    log('resolve', `SS search échoué pour "${title.slice(0, 50)}": HTTP ${res.status}`, 'warn')
    return null
  }
  const json = await res.json()
  const paper = json.data?.[0]
  if (!paper) {
    log('resolve', `Aucun résultat SS pour "${title.slice(0, 50)}"`, 'warn')
    return null
  }
  return paper.paperId as string
}

async function resolvePaperIds(titles: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const title of titles) {
    const id = await resolvePaperId(title)
    if (id) {
      ids.push(id)
      log('resolve', `✓ "${title.slice(0, 60)}" → ${id}`)
    }
    await sleep(SS_DELAY_MS)
  }
  log('resolve', `${ids.length}/${titles.length} paperIds résolus`)
  return ids
}

// ── Étape 3 : recommendations SS ─────────────────────────────────────────────

interface SsPaper {
  paperId: string
  title: string | null
  abstract: string | null
  url: string | null
  publicationDate: string | null
  year: number | null
  venue: string | null
  authors: { name: string }[]
  externalIds: { DOI?: string } | null
}

async function fetchRecommendations(positiveIds: string[]): Promise<SsPaper[]> {
  if (positiveIds.length === 0) return []

  log('api', `Appel SS recommendations — ${positiveIds.length} positive papers, max=${MAX_RECS}`)

  const res = await fetch(`${SS_RECS_URL}?fields=${SS_FIELDS}&limit=${MAX_RECS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positivePaperIds: positiveIds, negativePaperIds: [] }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SS recommendations API ${res.status}: ${body}`)
  }

  const json = await res.json()
  const papers: SsPaper[] = json.recommendedPapers ?? []
  log('api', `${papers.length} recommandations reçues`)
  return papers
}

// ── Étape 4 : dédup + insertion ───────────────────────────────────────────────

async function loadKnownDois(): Promise<Set<string>> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('veille_items')
    .select('doi')
    .not('doi', 'is', null)
    .limit(100_000)

  if (error) {
    log('dedup', `loadKnownDois échoué — dédup désactivé : ${error.message}`, 'warn')
    return new Set()
  }
  const dois = new Set((data ?? []).map((r: any) => r.doi as string))
  log('dedup', `${dois.size} DOIs connus chargés`)
  return dois
}

async function loadSsSourceId(): Promise<string> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('sources')
    .select('id')
    .eq('source_type', 'semantic_scholar')
    .single()

  if (error || !data) throw new Error(`Source semantic_scholar introuvable en DB : ${error?.message}`)
  log('source', `source_id=${data.id}`)
  return data.id
}

async function insertItems(items: VeilleItemInsert[]): Promise<number> {
  if (items.length === 0) return 0
  const sb     = getSupabase()
  let inserted = 0

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50)
    const { data, error } = await sb.from('veille_items').insert(batch).select('id')

    if (error) {
      if (error.code === '23505') {
        log('insert', `Batch ${Math.floor(i / 50) + 1} — doublon DOI ignoré`, 'warn')
      } else {
        log('insert', `Erreur batch ${i}: ${error.message}`, 'error')
      }
    } else {
      inserted += (data ?? []).length
      log('insert', `Batch ${Math.floor(i / 50) + 1} — ${(data ?? []).length} insérés`)
    }
  }
  return inserted
}

// ── Pipeline principal ────────────────────────────────────────────────────────

async function main() {
  const runId = process.env.RUN_ID?.trim()
  if (!runId) throw new Error('[extract-ss] RUN_ID manquant — doit être passé par Job 1')

  process.stderr.write(`\n🔭 [extract-ss] Démarrage — run_id=${runId}\n\n`)

  // Étape 1 : centroïde → titres représentatifs
  const titles = await loadRepresentativeTitles()
  if (titles.length === 0) {
    log('main', 'Aucun titre représentatif — arrêt (chunks auteur manquants ?)', 'warn')
    await appendLogs(runId)
    return
  }

  // Étape 2 : titres → paperIds SS
  const paperIds = await resolvePaperIds(titles)
  if (paperIds.length === 0) {
    log('main', 'Aucun paperId résolu sur SS — arrêt', 'warn')
    await appendLogs(runId)
    return
  }

  // Étape 3 : recommendations SS
  const papers = await fetchRecommendations(paperIds)

  // Étape 4 : dédup + insertion
  const [knownDois, sourceId] = await Promise.all([loadKnownDois(), loadSsSourceId()])

  let skippedNoAbstract = 0
  let skippedKnown      = 0
  const items: VeilleItemInsert[] = []

  for (const p of papers) {
    const doi = p.externalIds?.DOI ?? null
    if (doi && knownDois.has(doi)) { skippedKnown++; continue }
    if (!p.abstract || p.abstract.trim().length < 50) { skippedNoAbstract++; continue }

    items.push({
      run_id:       runId,
      source_id:    sourceId,
      url:          p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      title:        p.title ?? '(sans titre)',
      authors:      p.authors.map(a => a.name),
      doi,
      abstract:     p.abstract,
      published_at: p.publicationDate ?? (p.year ? `${p.year}-01-01` : null),
      last_error:   null,
    })

    if (doi) knownDois.add(doi)
  }

  log('filter', `${papers.length} reçus → ${skippedKnown} doublons, ${skippedNoAbstract} sans abstract, ${items.length} à insérer`)

  const inserted = await insertItems(items)
  log('main', `✅ ${inserted} articles Semantic Scholar insérés pour run_id=${runId}`)

  await appendLogs(runId)
}

main().catch(err => {
  process.stderr.write(`❌ [extract-ss] Erreur fatale: ${err.message}\n`)
  process.exit(1)
})
