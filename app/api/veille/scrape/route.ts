// POST /api/veille/scrape — triggers the veille pipeline (fire and forget)
// Returns immediately; pipeline runs in background

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { runVeillePipeline } from '../../../../lib/veille/pipeline'
import { createRun } from '../../../../lib/db/veille'

export async function POST() {
  console.log('[/api/veille/scrape] POST received')

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.warn('[/api/veille/scrape] Unauthorized')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await createRun()

  // Fire and forget — pipeline runs async in background
  runVeillePipeline(runId).catch(err =>
    console.error('[/api/veille/scrape] Pipeline error:', err.message)
  )

  console.log(`[/api/veille/scrape] Pipeline started run=${runId}`)
  return NextResponse.json({ ok: true, run_id: runId, message: 'Pipeline started' })
}
