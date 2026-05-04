// GET /api/veille/runs — returns list of all pipeline runs with stats
// Used by the front-end history tab

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  console.log('[/api/veille/runs] GET received')

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch runs with item counts via a join-style query
  const { data: runs, error } = await supabase
    .from('veille_runs')
    .select('id, status, started_at, completed_at, error_message')
    .order('started_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('[/api/veille/runs] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch item counts and scores per run
  const runIds = runs.map((r: any) => r.id)
  const { data: stats } = await supabase
    .from('veille_items')
    .select('run_id, similarity_score')
    .in('run_id', runIds)

  // Aggregate per run
  const statsByRun = new Map<string, { total: number; scored: number; best: number | null; avg: number | null }>()
  for (const row of stats ?? []) {
    const s = statsByRun.get(row.run_id) ?? { total: 0, scored: 0, best: null, avg: null }
    s.total++
    if (row.similarity_score !== null) {
      s.scored++
      s.best = s.best === null ? row.similarity_score : Math.max(s.best, row.similarity_score)
    }
    statsByRun.set(row.run_id, s)
  }

  // Compute averages
  const scoreSums = new Map<string, number>()
  for (const row of stats ?? []) {
    if (row.similarity_score !== null) {
      scoreSums.set(row.run_id, (scoreSums.get(row.run_id) ?? 0) + row.similarity_score)
    }
  }
  for (const [runId, s] of Array.from(statsByRun)) {
    if (s.scored > 0) s.avg = Math.round((scoreSums.get(runId) ?? 0) / s.scored * 1000) / 1000
  }

  const result = runs.map((r: any) => ({
    ...r,
    ...(statsByRun.get(r.id) ?? { total: 0, scored: 0, best: null, avg: null }),
  }))

  console.log(`[/api/veille/runs] ${result.length} runs returned`)
  return NextResponse.json({ runs: result })
}
