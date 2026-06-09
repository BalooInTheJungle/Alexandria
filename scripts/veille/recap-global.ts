#!/usr/bin/env ts-node
/**
 * scripts/veille/recap-global.ts — Job 4 : récap IA global du run
 *
 * Génère un résumé global (thèmes + synthèse) sur tous les articles
 * du run ayant un ai_analysis (analysés par recap-articles.ts).
 * Sauvegarde dans veille_runs.ai_summary + high_score_count.
 * Marque le run comme "completed".
 *
 * Usage : npx ts-node --project tsconfig.scripts.json scripts/veille/recap-global.ts
 *
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   OPENAI_API_KEY               — clé OpenAI
 *   RUN_ID                       — run_id issu du job extract
 */

import { createClient } from '@supabase/supabase-js'
import type { RunLogEntry, RunLogLevel, CorpusRef } from '../../lib/db/types'

// ── Config ────────────────────────────────────────────────────────────────────

const SCORE_THRESHOLD    = 0.75
const MAX_ABSTRACT_CHARS = 300
const MAX_EXCERPT_CHARS  = 150

// ── DB admin client ───────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[recap-global] Variables Supabase manquantes')
  return createClient(url, key)
}

// ── Logging ───────────────────────────────────────────────────────────────────

const scriptStart = Date.now()
const elapsed = () => `+${Math.round((Date.now() - scriptStart) / 1000)}s`
const collectedLogs: RunLogEntry[] = []

function log(phase: string, msg: string, level: RunLogLevel = 'info') {
  const ts = new Date().toISOString()
  const line = `[recap-global/${phase}] ${elapsed()} ${msg}`
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

async function completeRun(runId: string, status: 'completed' | 'failed', errorMsg?: string) {
  const sb = getSupabase()
  await sb.from('veille_runs').update({
    status,
    completed_at: new Date().toISOString(),
    error_message: errorMsg ?? null,
  }).eq('id', runId)
}

type AnalysedItem = {
  id: string
  title: string | null
  abstract: string | null
  source_name: string | null
  similarity_score: number | null
  corpus_refs: CorpusRef[] | null
  ai_analysis: { contribution: string; relevance: string; corpus_link: string } | null
}

async function loadAnalysedItems(runId: string): Promise<AnalysedItem[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('veille_items')
    .select('id, title, abstract, similarity_score, corpus_refs, ai_analysis, sources!inner(name)')
    .eq('run_id', runId)
    .not('ai_analysis', 'is', null)
    .gte('similarity_score', SCORE_THRESHOLD)
    .order('similarity_score', { ascending: false, nullsFirst: false })
  if (error) throw new Error(`loadAnalysedItems failed: ${error.message}`)

  return ((data ?? []) as any[]).map(r => ({
    id:               r.id,
    title:            r.title ?? null,
    abstract:         r.abstract ?? null,
    similarity_score: r.similarity_score ?? null,
    corpus_refs:      r.corpus_refs ?? null,
    ai_analysis:      r.ai_analysis ?? null,
    source_name:      Array.isArray(r.sources) ? r.sources[0]?.name ?? null : r.sources?.name ?? null,
  }))
}

async function saveRunSummary(runId: string, aiSummary: string, highScoreCount: number) {
  const sb = getSupabase()
  const { error } = await sb.from('veille_runs').update({
    ai_summary:       aiSummary,
    high_score_count: highScoreCount,
    score_threshold:  SCORE_THRESHOLD,
  }).eq('id', runId)
  if (error) log('save', `Erreur saveRunSummary: ${error.message}`, 'error')
}

// ── Prompt récap global ───────────────────────────────────────────────────────
// Différent de summarize.ts : utilise les ai_analysis déjà générés (pas les abstracts bruts)
// pour produire une synthèse de niveau supérieur (thèmes transversaux, tendances)

function buildGlobalPrompt(items: AnalysedItem[]): string {
  const articleBlocks = items.map((a, i) => {
    const refs = (a.corpus_refs ?? []).length > 0
      ? (a.corpus_refs!).map(r =>
          `  • [${r.doc_title}${r.page != null ? `, p.${r.page}` : ''}, ${Math.round(r.similarity * 100)}%]`
        ).join('\n')
      : '  (aucune référence corpus ≥ 75%)'

    const analysis = a.ai_analysis
    const analysisBlock = analysis
      ? `Contribution : ${analysis.contribution}\nPertinence   : ${analysis.relevance}\nLien corpus  : ${analysis.corpus_link}`
      : `Résumé brut  : ${(a.abstract ?? '').slice(0, MAX_ABSTRACT_CHARS)}`

    return `--- Article ${i + 1} ---
ID     : ${a.id}
Titre  : ${a.title ?? '(sans titre)'}
Source : ${a.source_name ?? 'inconnue'}
Score  : ${Math.round((a.similarity_score ?? 0) * 100)}%
${analysisBlock}
Références corpus :
${refs}`
  }).join('\n\n')

  return `Tu es un assistant de veille scientifique pour un chercheur CNRS spécialisé en matériaux moléculaires et magnétisme (complexes à transition de spin, aimants moléculaires, matériaux bistables, propriétés magnéto-optiques).

Voici ${items.length} articles pertinents de la veille du jour, avec leur analyse individuelle déjà réalisée.

${articleBlocks}

Ta tâche : produire un JSON valide avec cette structure exacte (aucun texte hors du JSON) :

{
  "themes": [
    {
      "title": "Nom court du thème (5 mots max)",
      "description": "2-3 phrases sur ce thème, son importance cette semaine, et son lien avec les travaux du chercheur."
    }
  ],
  "synthesis": "3-5 phrases de synthèse globale : tendances dominantes, signaux faibles, recommandations de lecture prioritaire."
}

Contraintes :
- Identifie 2 à 4 thèmes transversaux émergents de la semaine.
- La synthèse doit mentionner les articles les plus importants par leur titre.
- Réponds uniquement en français.
- Ne produis aucun texte hors du JSON.`
}

async function callGpt(prompt: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY manquant')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      max_tokens:      2000,
      temperature:     0.3,
      response_format: { type: 'json_object' },
      messages:        [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content ?? JSON.stringify({ themes: [], synthesis: '' })
}

// ── Pipeline récap global ─────────────────────────────────────────────────────

async function runRecapGlobal() {
  const runId = process.env.RUN_ID?.trim()
  if (!runId) throw new Error('RUN_ID manquant — ce script doit être appelé après recap-articles.ts')

  process.stderr.write(`\n🌐 [recap-global] Démarrage — run_id=${runId}\n\n`)

  await updatePhase(runId, 'recap_global')

  try {
    // ── Charge les articles analysés ────────────────────────────────────────
    const items = await loadAnalysedItems(runId)
    log('load', `${items.length} articles avec ai_analysis >= ${SCORE_THRESHOLD} chargés`)

    if (items.length === 0) {
      log('load', 'Aucun article analysé — récap global ignoré')
      await completeRun(runId, 'completed')
      await appendLogs(runId, collectedLogs)
      return
    }

    // ── Appel GPT ────────────────────────────────────────────────────────────
    log('gpt', `Construction du prompt global (${items.length} articles)`)
    const prompt   = buildGlobalPrompt(items)
    const gptStart = Date.now()

    log('gpt', 'Appel GPT-4o-mini — récap global')
    const summary = await callGpt(prompt)
    log('gpt', `GPT terminé en ${Math.round((Date.now() - gptStart) / 1000)}s — ${summary.length} chars`)

    // ── Sauvegarde ───────────────────────────────────────────────────────────
    await saveRunSummary(runId, summary, items.length)
    log('save', `ai_summary sauvegardé — ${items.length} articles, seuil=${SCORE_THRESHOLD}`)

    // ── Marquer le run comme terminé ─────────────────────────────────────────
    await completeRun(runId, 'completed')
    await updatePhase(runId, 'done')
    log('done', `Run ${runId} marqué completed`)

    await appendLogs(runId, collectedLogs)

    const totalElapsed = Math.round((Date.now() - scriptStart) / 1000)
    process.stderr.write(`\n✅ [recap-global] Terminé en ${totalElapsed}s — run_id=${runId}\n\n`)

  } catch (err: any) {
    log('fatal', `Erreur fatale : ${err.message}`, 'error')
    await completeRun(runId, 'failed', err.message)
    await appendLogs(runId, collectedLogs).catch(() => {})
    throw err
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

runRecapGlobal()
  .then(() => process.exit(0))
  .catch(err => {
    process.stderr.write(`[recap-global] FATAL: ${err.message}\n`)
    process.exit(1)
  })
