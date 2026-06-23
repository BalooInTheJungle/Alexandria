// DB layer — veille_runs and veille_items
// UI functions use server client (RLS); pipeline functions use service role (admin)

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { VeilleRun, VeilleItem, CorpusRef } from '@/lib/db/types'

const LOG = (msg: string, ...args: unknown[]) => console.log('[db/veille]', msg, ...args)

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type VeilleRunRow = VeilleRun
export type VeilleRunWithCount = VeilleRunRow & { items_count: number; ai_analysis_count: number; pertinent_count: number }
export type VeilleItemWithMeta = VeilleItem & {
  source_name: string | null
  document_id: string | null
  corpus_refs: CorpusRef[] | null
}

export interface VeilleItemInsert {
  run_id:       string
  source_id:    string
  url:          string
  title:        string
  authors:      string[]
  doi:          string | null
  abstract:     string | null
  published_at: string | null
  last_error:   string | null
}

// ── UI functions (server client, RLS) ─────────────────────────────────────────

export async function listVeilleRuns(limit = 50): Promise<VeilleRunRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('veille_runs')
    .select('id, status, started_at, completed_at, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) { LOG('listVeilleRuns error', error.message); throw error }
  LOG('listVeilleRuns', { count: (data ?? []).length, limit })
  return (data ?? []) as VeilleRunRow[]
}

export async function listVeilleRunsWithCounts(limit = 50): Promise<VeilleRunWithCount[]> {
  const supabase = await createClient()
  const lim = Math.max(1, Math.min(100, limit))

  const { data, error } = await supabase
    .from('veille_runs')
    .select('id, status, started_at, completed_at, error_message, created_at, ai_summary, high_score_count, score_threshold, veille_items(count)')
    .order('created_at', { ascending: false })
    .limit(lim)
  if (error) { LOG('listVeilleRunsWithCounts error', error.message); throw error }
  const rows = (data ?? []) as any[]

  // Fetch ai_analysis_count and pertinent_count in a single batch query
  const runIds = rows.map((r: any) => r.id as string)
  const admin = getAdminSupabase()

  const [aiRes, pertinentRes] = await Promise.all([
    admin.from('veille_items').select('run_id').in('run_id', runIds).not('ai_analysis', 'is', null),
    admin.from('veille_items').select('run_id').in('run_id', runIds).gte('similarity_score', 0.80),
  ])

  const aiCountByRun = new Map<string, number>()
  for (const row of (aiRes.data ?? [])) {
    aiCountByRun.set(row.run_id, (aiCountByRun.get(row.run_id) ?? 0) + 1)
  }
  const pertinentCountByRun = new Map<string, number>()
  for (const row of (pertinentRes.data ?? [])) {
    pertinentCountByRun.set(row.run_id, (pertinentCountByRun.get(row.run_id) ?? 0) + 1)
  }

  LOG('listVeilleRunsWithCounts', { count: rows.length })
  return rows.map((r: any) => ({
    ...r,
    items_count:       r.veille_items?.[0]?.count ?? 0,
    ai_analysis_count: aiCountByRun.get(r.id) ?? 0,
    pertinent_count:   pertinentCountByRun.get(r.id) ?? 0,
  }))
}

export type ListVeilleItemsOptions = { runId?: string; sourceId?: string; limit?: number; offset?: number; minScore?: number }

export async function listVeilleItems(options: ListVeilleItemsOptions = {}): Promise<VeilleItemWithMeta[]> {
  const { runId, sourceId, limit = 100, offset = 0, minScore } = options
  const supabase = getAdminSupabase()

  let query = supabase
    .from('veille_items')
    .select(`id, run_id, source_id, url, title, authors, doi, abstract, published_at,
      heuristic_score, similarity_score, author_score, corpus_refs, last_error, created_at, read_at, ai_analysis, sources!inner(name)`)
    .order('similarity_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (runId)    query = query.eq('run_id', runId)
  if (sourceId) query = query.eq('source_id', sourceId)
  if (minScore !== undefined) query = query.gte('similarity_score', minScore)

  const { data: items, error } = await query
  if (error) { LOG('listVeilleItems error', error.message); throw error }
  LOG('listVeilleItems', { count: (items ?? []).length, runId, sourceId, limit, offset })

  type Row = VeilleItem & { sources: { name: string | null }[] | { name: string | null } }
  const rows = (items ?? []) as Row[]

  const dois = Array.from(new Set(rows.map((r) => r.doi).filter((d): d is string => Boolean(d))))
  const doiToDocumentId = new Map<string, string>()
  if (dois.length > 0) {
    const { data: docs } = await supabase.from('documents').select('id, doi').in('doi', dois)
    for (const d of docs ?? []) { if (d.doi) doiToDocumentId.set(d.doi, d.id) }
  }

  const sourceName = (r: Row): string | null => {
    const s = r.sources
    if (!s) return null
    const obj = Array.isArray(s) ? s[0] : s
    return obj?.name ?? null
  }

  return rows.map((r) => ({
    id: r.id, run_id: r.run_id, source_id: r.source_id, url: r.url,
    title: r.title ?? undefined, authors: r.authors ?? undefined, doi: r.doi ?? undefined,
    abstract: r.abstract ?? undefined, published_at: (r as any).published_at ?? undefined,
    heuristic_score: (r as any).heuristic_score ?? undefined,
    similarity_score: r.similarity_score ?? undefined,
    author_score: (r as any).author_score ?? null,
    last_error: r.last_error ?? undefined,
    created_at: r.created_at, source_name: sourceName(r),
    document_id: r.doi ? doiToDocumentId.get(r.doi) ?? null : null,
    corpus_refs: (r as any).corpus_refs ?? null,
    read_at: (r as any).read_at ?? null,
    ai_analysis: (r as any).ai_analysis ?? null,
  }))
}

export async function getRunById(id: string): Promise<VeilleRunRow | null> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('veille_runs')
    .select('id, status, started_at, completed_at, error_message, created_at, phase, items_processed, items_total, ai_summary, high_score_count, score_threshold, pipeline_logs')
    .eq('id', id)
    .maybeSingle()

  if (error) { LOG('getRunById error', id, error.message); throw error }
  LOG('getRunById', { id, found: !!data, status: data?.status })
  return data as VeilleRunRow | null
}

// ── Pipeline functions (admin client, bypasses RLS) ───────────────────────────

export async function createRun(): Promise<string> {
  LOG('createRun')
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('veille_runs')
    .insert({ status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()

  if (error) throw new Error(`[db/veille] createRun failed: ${error.message}`)
  LOG('createRun ok', { id: data.id })
  return data.id
}

export async function saveRunSummary(
  runId: string,
  opts: { aiSummary: string; highScoreCount: number; scoreThreshold: number }
): Promise<void> {
  LOG('saveRunSummary', { runId, highScoreCount: opts.highScoreCount, scoreThreshold: opts.scoreThreshold, hasContent: !!opts.aiSummary })
  const supabase = getAdminSupabase()
  const update: Record<string, unknown> = {
    high_score_count: opts.highScoreCount,
    score_threshold:  opts.scoreThreshold,
  }
  if (opts.aiSummary) update.ai_summary = opts.aiSummary
  const { error } = await supabase.from('veille_runs').update(update).eq('id', runId)
  if (error) LOG('saveRunSummary error', error.message)
}

// Fetch top articles created today (UTC) across all runs, above a similarity threshold.
// Used by the 22h consolidated AI summary.
export async function listTodayTopArticles(threshold: number, limit = 10): Promise<VeilleItemWithMeta[]> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  LOG('listTodayTopArticles', { threshold, limit, since: todayStart.toISOString() })
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('veille_items')
    .select(`id, run_id, source_id, url, title, authors, doi, abstract, published_at,
      heuristic_score, similarity_score, corpus_refs, last_error, created_at, read_at, ai_analysis, sources!inner(name)`)
    .gte('similarity_score', threshold)
    .gte('created_at', todayStart.toISOString())
    .order('similarity_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) { LOG('listTodayTopArticles error', error.message); return [] }
  type Row = VeilleItem & { sources: { name: string | null }[] | { name: string | null } }
  const rows = (data ?? []) as Row[]
  const sourceName = (r: Row): string | null => {
    const s = r.sources
    if (!s) return null
    const obj = Array.isArray(s) ? s[0] : s
    return obj?.name ?? null
  }
  return rows.map(r => ({
    id: r.id, run_id: r.run_id, source_id: r.source_id, url: r.url,
    title: r.title ?? undefined, authors: r.authors ?? undefined, doi: r.doi ?? undefined,
    abstract: r.abstract ?? undefined, published_at: (r as any).published_at ?? undefined,
    heuristic_score: (r as any).heuristic_score ?? undefined,
    similarity_score: r.similarity_score ?? undefined,
    author_score: (r as any).author_score ?? null,
    last_error: r.last_error ?? undefined,
    created_at: r.created_at, source_name: sourceName(r),
    document_id: null, corpus_refs: (r as any).corpus_refs ?? null,
    read_at: (r as any).read_at ?? null, ai_analysis: (r as any).ai_analysis ?? null,
  }))
}

export async function completeRun(runId: string, status: 'completed' | 'failed', errorMessage?: string) {
  LOG(`completeRun ${runId} → ${status}`)
  const supabase = getAdminSupabase()
  const { error } = await supabase
    .from('veille_runs')
    .update({ status, completed_at: new Date().toISOString(), error_message: errorMessage ?? null })
    .eq('id', runId)

  if (error) LOG('completeRun error', error.message)
}

export async function getKnownDois(): Promise<Set<string>> {
  LOG('getKnownDois')
  const supabase = getAdminSupabase()

  const timeout = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error('getKnownDois timeout after 20s')), 20000)
  )
  const query = supabase
    .from('veille_items')
    .select('doi')
    .not('doi', 'is', null)
    .limit(100000)
    .then(({ data, error }) => {
      if (error) throw new Error(error.message)
      return data
    })

  try {
    const data = await Promise.race([query, timeout])
    if (!data) return new Set()
    const dois = new Set(data.map((r: any) => r.doi as string))
    LOG('getKnownDois ok', { count: dois.size })
    return dois
  } catch (err: any) {
    // CRITICAL: returning empty set means all articles will be treated as new → duplicates
    // The DB unique index is the last line of defense when this happens.
    LOG('getKnownDois FAILED — dedup disabled for this run:', err.message)
    return new Set()
  }
}

export async function savePipelineLogs(runId: string, logs: import('./types').RunLogEntry[]): Promise<void> {
  if (logs.length === 0) return
  const supabase = getAdminSupabase()
  const { error } = await supabase
    .from('veille_runs')
    .update({ pipeline_logs: logs })
    .eq('id', runId)
  if (error) LOG('savePipelineLogs error', error.message)
}

export async function updateRunPhase(
  runId: string,
  phase: string,
  itemsProcessed?: number,
  itemsTotal?: number
): Promise<void> {
  LOG('updateRunPhase', { runId, phase, itemsProcessed, itemsTotal })
  const supabase = getAdminSupabase()
  const patch: Record<string, unknown> = { phase }
  if (itemsProcessed !== undefined) patch.items_processed = itemsProcessed
  if (itemsTotal !== undefined)     patch.items_total     = itemsTotal
  const { error } = await supabase.from('veille_runs').update(patch).eq('id', runId)
  if (error) LOG('updateRunPhase error', error.message)
}

export async function updateVeilleItemScores(scores: Map<string, number>): Promise<void> {
  if (scores.size === 0) return
  LOG('updateVeilleItemScores', { count: scores.size })
  const supabase = getAdminSupabase()

  for (const [id, similarity_score] of Array.from(scores)) {
    const { error } = await supabase.from('veille_items').update({ similarity_score }).eq('id', id)
    if (error) LOG('updateVeilleItemScores error', id, error.message)
  }
}

export async function updateVeilleItemBothScores(
  scores: Map<string, { similarity: number | null; heuristic: number | null; refs?: CorpusRef[] }>
): Promise<void> {
  if (scores.size === 0) return
  LOG('updateVeilleItemBothScores', { count: scores.size })
  const supabase = getAdminSupabase()

  const entries = Array.from(scores).filter(([, { similarity, heuristic, refs }]) => {
    const patch: Record<string, unknown> = {}
    if (similarity !== null) patch.similarity_score = similarity
    if (heuristic !== null)  patch.heuristic_score  = heuristic
    if (refs && refs.length > 0) patch.corpus_refs = refs
    return Object.keys(patch).length > 0
  })

  const BATCH = 50
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH)
    await Promise.all(batch.map(async ([id, { similarity, heuristic, refs }]) => {
      const patch: Record<string, unknown> = {}
      if (similarity !== null) patch.similarity_score = similarity
      if (heuristic !== null)  patch.heuristic_score  = heuristic
      if (refs && refs.length > 0) patch.corpus_refs = refs
      const { error } = await supabase.from('veille_items').update(patch).eq('id', id)
      if (error) LOG('updateVeilleItemBothScores error', id, error.message)
    }))
  }
}

export async function insertVeilleItems(items: VeilleItemInsert[]): Promise<number> {
  const inserted = await insertVeilleItemsWithIds(items)
  return inserted.length
}

export async function saveItemsAiAnalysis(
  analyses: { item_id: string; contribution: string; relevance: string; corpus_link: string }[]
): Promise<void> {
  if (analyses.length === 0) return
  LOG('saveItemsAiAnalysis', { count: analyses.length })
  const supabase = getAdminSupabase()

  let updated = 0
  let errors = 0
  for (const a of analyses) {
    const { error } = await supabase
      .from('veille_items')
      .update({ ai_analysis: { contribution: a.contribution, relevance: a.relevance, corpus_link: a.corpus_link } })
      .eq('id', a.item_id)
    if (error) {
      errors++
      LOG('saveItemsAiAnalysis error', { item_id: a.item_id, error: error.message })
    } else {
      updated++
      LOG('saveItemsAiAnalysis updated', { item_id: a.item_id })
    }
  }

  LOG('saveItemsAiAnalysis done', { updated, errors, total: analyses.length })
}

export async function insertVeilleItemsWithIds(
  items: VeilleItemInsert[]
): Promise<{ id: string; abstract: string | null }[]> {
  if (items.length === 0) return []
  LOG('insertVeilleItemsWithIds', { count: items.length })
  const supabase = getAdminSupabase()
  const inserted: { id: string; abstract: string | null }[] = []

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50)
    const { data, error } = await supabase.from('veille_items').upsert(batch, { onConflict: 'doi', ignoreDuplicates: true }).select('id, abstract')
    if (error) LOG('insertVeilleItemsWithIds batch error', error.message)
    else inserted.push(...(data ?? []))
  }

  LOG('insertVeilleItemsWithIds done', { inserted: inserted.length, total: items.length })
  return inserted
}
