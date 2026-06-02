export const maxDuration = 60

import { NextResponse } from 'next/server'
import { listVeilleItems, saveRunSummary, getRunById } from '@/lib/db/veille'
import { generateVeilleSummary } from '@/lib/veille/summarize'

const LOG = (msg: string, ...args: unknown[]) =>
  console.log('[API] POST /api/veille/summarize/[runId]', msg, ...args)

type Params = { params: Promise<{ runId: string }> }

export async function POST(request: Request, { params }: Params) {
  // Same secret as other cron routes
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { runId } = await params
  LOG('start', { runId })

  try {
    const run = await getRunById(runId)
    if (!run) {
      LOG('not found', { runId })
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    // Fetch scored items for this run — already ordered by similarity_score DESC
    const items = await listVeilleItems({ runId, limit: 1000 })
    LOG('items loaded', { count: items.length })

    const THRESHOLD = 0.75
    const MAX_FOR_SUMMARY = 10

    const eligible = items.filter(i => (i.similarity_score ?? 0) >= THRESHOLD)
    const top = eligible.slice(0, MAX_FOR_SUMMARY)
    LOG('eligible', { eligibleCount: eligible.length, sending: top.length, threshold: THRESHOLD })

    const forSummary = top.map(item => ({
      id:               item.id,
      title:            item.title ?? '',
      abstract:         item.abstract ?? null,
      source_name:      item.source_name,
      similarity_score: item.similarity_score ?? null,
      corpus_refs:      item.corpus_refs ?? [],
    }))

    const { summary, highScoreCount } = await generateVeilleSummary(forSummary, THRESHOLD)
    await saveRunSummary(runId, { aiSummary: summary, highScoreCount, scoreThreshold: THRESHOLD })

    LOG('done', { highScoreCount })
    return NextResponse.json({ ok: true, highScoreCount })
  } catch (err: any) {
    LOG('error', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
