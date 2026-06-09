#!/usr/bin/env ts-node
/**
 * scripts/veille/score.ts — Job 2 : scoring sémantique
 *
 * Charge tous les articles du run avec similarity_score IS NULL,
 * embed chaque abstract → match_chunks RPC → similarity_score + corpus_refs.
 * Pas de cap MAX_ITEMS : score l'intégralité du run.
 * Reprend automatiquement là où il s'est arrêté si le job est relancé.
 *
 * Usage : npx ts-node --project tsconfig.scripts.json scripts/veille/score.ts
 *
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   RUN_ID                       — run_id issu du job extract
 */

import { createClient } from '@supabase/supabase-js'
import { scoreVeilleItems, loadCorpusTerms, scoreHeuristic } from '../../lib/veille/score'
import type { RunLogEntry, RunLogLevel, CorpusRef } from '../../lib/db/types'

// ── Config ────────────────────────────────────────────────────────────────────

// Concurrence augmentée (10 vs 5 en prod Vercel) — GitHub Actions n'a pas de limite serverless
const SCORE_CONCURRENCY = 10

// ── DB admin client ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[score] NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
  return createClient(url, key)
}

// ── Logging ───────────────────────────────────────────────────────────────────

const scriptStart = Date.now()
const elapsed = () => `+${Math.round((Date.now() - scriptStart) / 1000)}s`
const collectedLogs: RunLogEntry[] = []

function log(phase: string, msg: string, level: RunLogLevel = 'info') {
  const ts = new Date().toISOString()
  const line = `[score/${phase}] ${elapsed()} ${msg}`
  if (level === 'error') process.stderr.write(`❌ ${line}\n`)
  else if (level === 'warn') process.stderr.write(`⚠️  ${line}\n`)
  else process.stderr.write(`   ${line}\n`)
  collectedLogs.push({ ts, level, phase, msg })
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function updatePhase(runId: string, phase: string, processed?: number, total?: number) {
  const sb = getSupabase()
  const patch: Record<string, unknown> = { phase }
  if (processed !== undefined) patch.items_processed = processed
  if (total !== undefined)     patch.items_total     = total
  await sb.from('veille_runs').update(patch).eq('id', runId)
}

async function appendLogs(runId: string, newLogs: RunLogEntry[]) {
  if (newLogs.length === 0) return
  const sb = getSupabase()
  // Charge les logs existants pour les fusionner (extract.ts a déjà écrit les siens)
  const { data } = await sb.from('veille_runs').select('pipeline_logs').eq('id', runId).single()
  const existing: RunLogEntry[] = (data?.pipeline_logs as RunLogEntry[]) ?? []
  await sb.from('veille_runs').update({ pipeline_logs: [...existing, ...newLogs] }).eq('id', runId)
}

async function loadUnscoredItems(runId: string): Promise<{ id: string; abstract: string | null }[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('veille_items')
    .select('id, abstract')
    .eq('run_id', runId)
    .is('similarity_score', null)
    .limit(10_000)
  if (error) throw new Error(`loadUnscoredItems failed: ${error.message}`)
  return (data ?? []) as { id: string; abstract: string | null }[]
}

async function saveScores(
  scores: Map<string, { similarity: number | null; heuristic: number | null; refs: CorpusRef[] }>
) {
  if (scores.size === 0) return
  const sb = getSupabase()
  const entries = Array.from(scores)
  const BATCH = 50

  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH)
    await Promise.all(batch.map(async ([id, { similarity, heuristic, refs }]) => {
      const patch: Record<string, unknown> = {}
      if (similarity !== null)  patch.similarity_score = similarity
      if (heuristic !== null)   patch.heuristic_score  = heuristic
      if (refs.length > 0)      patch.corpus_refs      = refs
      if (Object.keys(patch).length === 0) return
      const { error } = await sb.from('veille_items').update(patch).eq('id', id)
      if (error) log('save', `Erreur update id=${id.slice(0, 8)}: ${error.message}`, 'error')
    }))
    log('save', `Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(entries.length / BATCH)} sauvegardé`)
  }
}

// ── Pipeline scoring ──────────────────────────────────────────────────────────

async function runScoring() {
  const runId = process.env.RUN_ID?.trim()
  if (!runId) throw new Error('RUN_ID manquant — ce script doit être appelé après extract.ts')

  process.stderr.write(`\n🎯 [score] Démarrage — run_id=${runId}\n\n`)

  // ── Charge les articles à scorer ──────────────────────────────────────────
  await updatePhase(runId, 'scoring')
  const items = await loadUnscoredItems(runId)
  log('load', `${items.length} articles à scorer (similarity_score IS NULL)`)

  if (items.length === 0) {
    log('load', 'Aucun article à scorer — tous déjà scorés ou run vide')
    await appendLogs(runId, collectedLogs)
    return
  }

  await updatePhase(runId, 'scoring', 0, items.length)

  // ── Charge les termes corpus pour le score heuristique ───────────────────
  const corpusTerms = await loadCorpusTerms(80)
  log('corpus', `${corpusTerms.length} termes corpus chargés pour heuristique`)

  // ── Scoring sémantique + heuristique ─────────────────────────────────────
  // scoreVeilleItems utilise SCORE_CONCURRENCY interne (5) — on override via env
  // (le module lit process.env si besoin, sinon on re-implémente le batch ici)
  process.env.SCORE_CONCURRENCY = String(SCORE_CONCURRENCY)

  let progressCount = 0
  const scoreStart = Date.now()

  const simScores = await scoreVeilleItems(items, async (done, total) => {
    progressCount = done
    await updatePhase(runId, 'scoring', done, total)
    const rate = done / Math.max(1, (Date.now() - scoreStart) / 1000)
    const eta  = Math.round((total - done) / Math.max(0.1, rate))
    log('scoring', `${done}/${total} scorés — ~${eta}s restants`)
  })

  log('scoring', `Embedding + match_chunks terminé — ${simScores.size} résultats`)

  // ── Fusion similarity + heuristic + corpus_refs ────────────────────────
  let timeouts = 0
  const bothScores = new Map<string, { similarity: number | null; heuristic: number | null; refs: CorpusRef[] }>()

  for (const { id, abstract } of items) {
    const result     = simScores.get(id)
    const similarity = result?.similarity ?? null
    const refs       = result?.refs ?? []
    const heuristic  = abstract && abstract.length > 50 && corpusTerms.length > 0
      ? scoreHeuristic(abstract, corpusTerms)
      : null

    bothScores.set(id, { similarity, heuristic, refs })
    if (similarity === null) timeouts++
  }

  if (timeouts > 0) {
    log('scoring', `${timeouts}/${items.length} articles en timeout match_chunks (similarity=null) — seront ignorés du résumé`, 'warn')
  }

  const scored = items.length - timeouts
  log('scoring', `${scored} articles scorés avec succès, ${timeouts} timeouts`)

  // ── Sauvegarde en DB ──────────────────────────────────────────────────────
  log('save', `Sauvegarde de ${bothScores.size} scores en DB (batch 50)`)
  await saveScores(bothScores)
  await updatePhase(runId, 'scored', items.length, items.length)

  // Stats finales
  const highScore = Array.from(bothScores.values()).filter(s => (s.similarity ?? 0) >= 0.75).length
  const elapsed30 = Array.from(bothScores.values()).filter(s => (s.similarity ?? 0) >= 0.30).length
  log('done', `Scoring terminé — ${scored} scorés | ${highScore} ≥75% | ${elapsed30} ≥30%`)

  // ── Sauvegarde logs ───────────────────────────────────────────────────────
  await appendLogs(runId, collectedLogs)

  const totalElapsed = Math.round((Date.now() - scriptStart) / 1000)
  process.stderr.write(`\n✅ [score] Terminé en ${totalElapsed}s — ${scored}/${items.length} articles scorés\n\n`)
}

// ── Entry point ───────────────────────────────────────────────────────────────

runScoring()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`[score] FATAL: ${err.message}\n`)
    process.exit(1)
  })
