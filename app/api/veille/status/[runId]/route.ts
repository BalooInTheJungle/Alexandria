// GET /api/veille/status/[runId] — poll pipeline run status
// Returns run metadata + item counts for front-end progress display

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(
  _request: Request,
  { params }: { params: { runId: string } }
) {
  const { runId } = params
  console.log(`[/api/veille/status] GET run ${runId}`)

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: run, error: runError } = await supabase
    .from('veille_runs')
    .select('id, status, started_at, completed_at, error_message')
    .eq('id', runId)
    .single()

  if (runError || !run) {
    console.warn(`[/api/veille/status] Run ${runId} not found`)
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const { count: itemCount } = await supabase
    .from('veille_items')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)

  const { count: scoredCount } = await supabase
    .from('veille_items')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId)
    .not('similarity_score', 'is', null)

  console.log(`[/api/veille/status] run=${run.status} items=${itemCount} scored=${scoredCount}`)
  return NextResponse.json({
    run_id:        run.id,
    status:        run.status,
    started_at:    run.started_at,
    completed_at:  run.completed_at,
    error_message: run.error_message,
    item_count:    itemCount ?? 0,
    scored_count:  scoredCount ?? 0,
  })
}
