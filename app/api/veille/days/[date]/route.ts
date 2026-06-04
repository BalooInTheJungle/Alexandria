// GET /api/veille/days/[date]
// Returns all runs for a given UTC date (YYYY-MM-DD) with aggregated stats + items.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(_req: Request, { params }: { params: { date: string } }) {
  const date = params.date  // YYYY-MM-DD
  console.log('[API] GET /api/veille/days/[date]', { date })

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
  }

  const supabase = getSupabase()
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd   = `${date}T23:59:59.999Z`

  // Fetch all runs for this day
  const { data: runs, error: runsErr } = await supabase
    .from('veille_runs')
    .select('id, status, phase, started_at, completed_at, error_message, ai_summary, high_score_count, score_threshold, pipeline_logs')
    .gte('started_at', dayStart)
    .lte('started_at', dayEnd)
    .order('started_at', { ascending: true })

  if (runsErr) {
    console.error('[API] veille/days error:', runsErr.message)
    return NextResponse.json({ error: runsErr.message }, { status: 500 })
  }

  if (!runs || runs.length === 0) {
    return NextResponse.json({ date, runs: [], items: [], stats: { total: 0, scored: 0, pertinent: 0 } })
  }

  const runIds = runs.map(r => r.id)

  // Fetch all items for these runs, sorted by score
  const { data: items, error: itemsErr } = await supabase
    .from('veille_items')
    .select(`id, run_id, url, title, authors, doi, abstract, published_at,
      similarity_score, heuristic_score, corpus_refs, read_at, ai_analysis,
      sources!inner(name)`)
    .in('run_id', runIds)
    .order('similarity_score', { ascending: false, nullsFirst: false })
    .limit(500)

  if (itemsErr) {
    console.error('[API] veille/days items error:', itemsErr.message)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  const allItems = (items ?? []).map((i: any) => ({
    ...i,
    source_name: Array.isArray(i.sources) ? i.sources[0]?.name : i.sources?.name,
    sources: undefined,
  }))

  // Aggregate stats across all runs
  const stats = {
    total:     allItems.length,
    scored:    allItems.filter((i: any) => i.similarity_score != null).length,
    pertinent: allItems.filter((i: any) => (i.similarity_score ?? 0) >= 0.75).length,
    runsCount: runs.length,
  }

  // Daily AI summary = from the latest run that has one
  const dailySummary = [...runs].reverse().find(r => r.ai_summary)?.ai_summary ?? null
  const dailyRunId   = [...runs].reverse().find(r => r.ai_summary)?.id ?? null

  console.log('[API] GET /api/veille/days/[date] ok', { date, runs: runs.length, items: allItems.length, ...stats })

  return NextResponse.json({ date, runs, items: allItems, stats, dailySummary, dailyRunId })
}
