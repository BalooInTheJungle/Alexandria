#!/usr/bin/env ts-node
/**
 * scripts/veille/recap-articles.ts — Job 3 : récap IA par article
 *
 * Charge les articles du run avec similarity_score >= SEUIL,
 * génère un ai_analysis (contribution, relevance, corpus_link) via GPT-4o-mini
 * pour les top MAX_ARTICLES articles les plus pertinents.
 *
 * Usage : npx ts-node --project tsconfig.scripts.json scripts/veille/recap-articles.ts
 *
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   OPENAI_API_KEY               — clé OpenAI
 *   RUN_ID                       — run_id issu du job extract
 */

import { createClient } from '@supabase/supabase-js'
import { generateVeilleSummary, parseSummary } from '../../lib/veille/summarize'
import type { RunLogEntry, RunLogLevel, CorpusRef } from '../../lib/db/types'

// ── Config ────────────────────────────────────────────────────────────────────

const SCORE_THRESHOLD = 0.75  // seuil minimum pour être analysé par GPT
const MAX_ARTICLES    = 50   // cap de sécurité (normalement ~10-15 articles ≥75%)

// ── DB admin client ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[recap-articles] Variables Supabase manquantes')
  return createClient(url, key)
}

// ── Logging ───────────────────────────────────────────────────────────────────

const scriptStart = Date.now()
const elapsed = () => `+${Math.round((Date.now() - scriptStart) / 1000)}s`
const collectedLogs: RunLogEntry[] = []

function log(phase: string, msg: string, level: RunLogLevel = 'info') {
  const ts = new Date().toISOString()
  const line = `[recap-articles/${phase}] ${elapsed()} ${msg}`
  if (level === 'error') process.stderr.write(`❌ ${line}\n`)
  else if (level === 'warn') process.stderr.write(`⚠️  ${line}\n`)
  else process.stderr.write(`   ${line}\n`)
  collectedLogs.push({ ts, level, phase, msg })
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function updatePhase(runId: string, phase: string) {
  await getSupabase().from('veille_runs').update({ phase }).eq('id', runId)
}

async function appendLogs(runId: string, newLogs: RunLogEntry[]) {
  if (newLogs.length === 0) return
  const sb = getSupabase()
  const { data } = await sb.from('veille_runs').select('pipeline_logs').eq('id', runId).single()
  const existing: RunLogEntry[] = (data?.pipeline_logs as RunLogEntry[]) ?? []
  await sb.from('veille_runs').update({ pipeline_logs: [...existing, ...newLogs] }).eq('id', runId)
}

type ScoredItem = {
  id: string
  title: string | null
  abstract: string | null
  source_name: string | null
  similarity_score: number | null
  corpus_refs: CorpusRef[] | null
}

async function loadTopScoredItems(runId: string): Promise<ScoredItem[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('veille_items')
    .select('id, title, abstract, similarity_score, corpus_refs, sources!inner(name)')
    .eq('run_id', runId)
    .gte('similarity_score', SCORE_THRESHOLD)
    .order('similarity_score', { ascending: false, nullsFirst: false })
    .limit(MAX_ARTICLES)
  if (error) throw new Error(`loadTopScoredItems failed: ${error.message}`)

  return ((data ?? []) as any[]).map(r => ({
    id:               r.id,
    title:            r.title ?? null,
    abstract:         r.abstract ?? null,
    similarity_score: r.similarity_score ?? null,
    corpus_refs:      r.corpus_refs ?? null,
    source_name:      Array.isArray(r.sources) ? r.sources[0]?.name ?? null : r.sources?.name ?? null,
  }))
}

async function saveAiAnalysis(
  analyses: { item_id: string; contribution: string; relevance: string; corpus_link: string }[]
) {
  if (analyses.length === 0) return
  const sb = getSupabase()
  let saved = 0
  let errors = 0
  for (const a of analyses) {
    const { error } = await sb
      .from('veille_items')
      .update({ ai_analysis: { contribution: a.contribution, relevance: a.relevance, corpus_link: a.corpus_link } })
      .eq('id', a.item_id)
    if (error) { errors++; log('save', `Erreur ai_analysis id=${a.item_id.slice(0, 8)}: ${error.message}`, 'error') }
    else saved++
  }
  log('save', `ai_analysis sauvegardé — ${saved} articles mis à jour, ${errors} erreurs`)
}

// ── Pipeline récap articles ───────────────────────────────────────────────────

async function runRecapArticles() {
  const runId = process.env.RUN_ID?.trim()
  if (!runId) throw new Error('RUN_ID manquant — ce script doit être appelé après score.ts')

  process.stderr.write(`\n📝 [recap-articles] Démarrage — run_id=${runId}\n\n`)

  await updatePhase(runId, 'recap_articles')

  // ── Charge les articles éligibles ────────────────────────────────────────
  const items = await loadTopScoredItems(runId)
  log('load', `${items.length} articles >= ${SCORE_THRESHOLD} chargés`)

  if (items.length === 0) {
    log('load', `Aucun article >= ${SCORE_THRESHOLD} — récap articles ignoré`)
    await appendLogs(runId, collectedLogs)
    return
  }

  // ── Appel GPT via generateVeilleSummary ───────────────────────────────────
  // generateVeilleSummary attend les items avec similarity_score et corpus_refs
  const forGpt = items.map(item => ({
    id:               item.id,
    title:            item.title ?? '',
    abstract:         item.abstract ?? null,
    source_name:      item.source_name,
    similarity_score: item.similarity_score,
    corpus_refs:      item.corpus_refs ?? [],
  }))

  log('gpt', `Envoi de ${forGpt.length} articles à GPT-4o-mini`)
  const gptStart = Date.now()

  const { summary, highScoreCount } = await generateVeilleSummary(forGpt, SCORE_THRESHOLD)
  log('gpt', `GPT terminé en ${Math.round((Date.now() - gptStart) / 1000)}s — ${highScoreCount} articles analysés`)

  // ── Parse + sauvegarde ai_analysis par article ────────────────────────────
  const parsed = parseSummary(summary)
  if (!parsed || parsed.articles.length === 0) {
    log('parse', 'Aucun article parsé depuis la réponse GPT', 'warn')
    await appendLogs(runId, collectedLogs)
    return
  }

  log('parse', `${parsed.articles.length} analyses parsées (${parsed.themes.length} thèmes identifiés)`)
  await saveAiAnalysis(parsed.articles)

  await updatePhase(runId, 'recap_articles_done')
  await appendLogs(runId, collectedLogs)

  const totalElapsed = Math.round((Date.now() - scriptStart) / 1000)
  process.stderr.write(`\n✅ [recap-articles] Terminé en ${totalElapsed}s — ${parsed.articles.length} articles analysés\n\n`)
}

// ── Entry point ───────────────────────────────────────────────────────────────

runRecapArticles()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`[recap-articles] FATAL: ${err.message}\n`)
    process.exit(1)
  })
