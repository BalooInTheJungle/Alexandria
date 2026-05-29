// GET /api/cron/veille — runs the veille pipeline on a schedule
// Called daily by GitHub Actions cron. Protected by CRON_SECRET.
// Uses waitUntil to respond immediately and run the pipeline in the background
// (compatible with Vercel Hobby plan — no maxDuration needed).

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { runVeillePipeline } from '@/lib/veille/pipeline'
import { createRun } from '@/lib/db/veille'

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization')
  if (auth?.startsWith('Bearer ') && auth.slice(7) === secret) return true
  return new URL(request.url).searchParams.get('secret') === secret
}

export async function GET(request: Request) {
  console.log('[cron/veille] GET received')

  if (!isAuthorized(request)) {
    console.warn('[cron/veille] Unauthorized request')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await createRun()
  console.log(`[cron/veille] Pipeline scheduled run=${runId}`)

  waitUntil(
    runVeillePipeline(runId)
      .then(stats => console.log(`[cron/veille] Done — inserted=${stats.inserted} skipped=${stats.skipped} errors=${stats.errors}`))
      .catch(err => console.error('[cron/veille] Fatal error:', err.message))
  )

  return NextResponse.json({ ok: true, run_id: runId, status: 'running' })
}
