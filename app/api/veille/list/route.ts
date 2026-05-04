// GET /api/veille/list — returns ranked veille_items from last completed run
// Ordered by similarity_score DESC

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET(request: Request) {
  console.log('[/api/veille/list] GET received')

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get last completed run
  const { data: run } = await supabase
    .from('veille_runs')
    .select('id, completed_at')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .single()

  if (!run) {
    console.log('[/api/veille/list] No completed run found')
    return NextResponse.json({ items: [], run_id: null })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 200)

  const { data: items, error } = await supabase
    .from('veille_items')
    .select('id, title, authors, doi, abstract, url, published_at, similarity_score, last_error')
    .eq('run_id', run.id)
    .order('similarity_score', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    console.error('[/api/veille/list] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[/api/veille/list] ${items.length} items from run ${run.id}`)
  return NextResponse.json({ items, run_id: run.id, run_date: run.completed_at })
}
