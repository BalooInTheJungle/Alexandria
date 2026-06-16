#!/usr/bin/env ts-node
/**
 * scripts/veille/extract-semanticscholar.ts — Job 1b : Semantic Scholar Recommendations
 *
 * Charge les DOIs des articles auteur depuis Supabase, appelle l'API Semantic Scholar
 * recommendations, filtre les articles avec abstract, insère dans veille_items.
 *
 * Usage : npx tsx scripts/veille/extract-semanticscholar.ts
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   RUN_ID                       — run_id créé par extract.ts (Job 1)
 *   SS_MAX_RECOMMENDATIONS       — (optionnel) nombre max de recommandations (défaut: 100)
 */

import { createClient } from '@supabase/supabase-js'
import type { VeilleItemInsert } from '../../lib/db/veille'
import type { RunLogEntry, RunLogLevel } from '../../lib/db/types'

// ── Config ────────────────────────────────────────────────────────────────────

const SS_BASE_URL      = 'https://api.semanticscholar.org/recommendations/v1/papers/'
const SS_FIELDS        = 'paperId,title,authors,year,publicationDate,externalIds,abstract,url,venue'
const MAX_RECS         = parseInt(process.env.SS_MAX_RECOMMENDATIONS ?? '100', 10)
const AUTHOR_DOI_LIMIT = 500 // max DOIs envoyés comme positive papers

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
  // Charge les logs existants et y ajoute les nôtres
  const { data } = await sb.from('veille_runs').select('pipeline_logs').eq('id', runId).single()
  const existing: RunLogEntry[] = (data?.pipeline_logs as RunLogEntry[]) ?? []
  await sb.from('veille_runs').update({ pipeline_logs: [...existing, ...collectedLogs] }).eq('id', runId)
  log('logs', `${collectedLogs.length} logs sauvegardés en DB`)
}

// ── Chargement des DOIs auteur ────────────────────────────────────────────────

async function loadAuthorDois(): Promise<string[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('documents')
    .select('doi')
    .eq('is_author_article', true)
    .not('doi', 'is', null)
    .limit(AUTHOR_DOI_LIMIT)

  if (error) throw new Error(`loadAuthorDois: ${error.message}`)
  const dois = (data ?? []).map((r: any) => r.doi as string).filter(Boolean)
  log('author-dois', `${dois.length} DOIs auteur chargés`)
  return dois
}

// ── Chargement des DOIs déjà en base (dédup) ─────────────────────────────────

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

// ── Chargement de la source SS en DB ─────────────────────────────────────────

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

// ── Appel API Semantic Scholar ────────────────────────────────────────────────

interface SsPaper {
  paperId: string
  title: string | null
  abstract: string | null
  url: string | null
  publicationDate: string | null
  year: number | null
  venue: string | null
  authors: { name: string }[]
  externalIds: { DOI?: string; ArXiv?: string } | null
}

async function fetchRecommendations(positiveDois: string[]): Promise<SsPaper[]> {
  // SS accepte des IDs sous la forme "DOI:10.1234/..." ou des paperId SS
  const positiveIds = positiveDois.slice(0, AUTHOR_DOI_LIMIT).map(doi => `DOI:${doi}`)

  log('api', `Appel SS recommendations — ${positiveIds.length} positive papers, max=${MAX_RECS}`)

  const res = await fetch(`${SS_BASE_URL}?fields=${SS_FIELDS}&limit=${MAX_RECS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positivePaperIds: positiveIds, negativePaperIds: [] }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SS API ${res.status}: ${body}`)
  }

  const json = await res.json()
  const papers: SsPaper[] = json.recommendedPapers ?? []
  log('api', `${papers.length} recommandations reçues`)
  return papers
}

// ── Insertion en batch ────────────────────────────────────────────────────────

async function insertItems(items: VeilleItemInsert[]): Promise<number> {
  if (items.length === 0) return 0
  const sb    = getSupabase()
  let inserted = 0

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50)
    const { data, error } = await sb
      .from('veille_items')
      .insert(batch)
      .select('id')

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

  const [authorDois, knownDois, sourceId] = await Promise.all([
    loadAuthorDois(),
    loadKnownDois(),
    loadSsSourceId(),
  ])

  if (authorDois.length === 0) {
    log('main', 'Aucun DOI auteur trouvé — arrêt', 'warn')
    await appendLogs(runId)
    return
  }

  // Appel API SS
  const papers = await fetchRecommendations(authorDois)

  // Filtre + construction des items
  let skippedNoAbstract = 0
  let skippedKnown      = 0
  const items: VeilleItemInsert[] = []

  for (const p of papers) {
    const doi = p.externalIds?.DOI ?? null

    // Dédup DOI
    if (doi && knownDois.has(doi)) { skippedKnown++; continue }

    // Abstract requis
    if (!p.abstract || p.abstract.trim().length < 50) { skippedNoAbstract++; continue }

    items.push({
      run_id:          runId,
      source_id:       sourceId,
      url:             p.url ?? `https://www.semanticscholar.org/paper/${p.paperId}`,
      title:           p.title ?? '(sans titre)',
      authors:         p.authors.map(a => a.name),
      doi,
      abstract:        p.abstract,
      published_at:    p.publicationDate ?? (p.year ? `${p.year}-01-01` : null),
      last_error:      null,
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
