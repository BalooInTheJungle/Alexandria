// GET /api/veille/sources  — liste toutes les sources (actives et inactives)
// POST /api/veille/sources — ajouter une nouvelle source

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSources, addSource } from '@/lib/db/sources'
import type { SourceInsert } from '@/lib/db/types'

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  console.log('[/api/veille/sources] GET received')

  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sources = await getSources()
  console.log('[/api/veille/sources] result:', { count: sources.length })
  return NextResponse.json({ sources })
}

export async function POST(request: Request) {
  console.log('[/api/veille/sources] POST received')

  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Partial<SourceInsert>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { name, url, publisher, issn, rss_url } = body
  if (!name || !url) {
    return NextResponse.json({ error: 'name and url are required' }, { status: 400 })
  }

  const source_type = rss_url ? 'rss' : 'openalex'

  const insert: SourceInsert = {
    name,
    url,
    publisher: publisher ?? null,
    issn: issn ?? null,
    rss_url: rss_url ?? null,
    source_type,
    active: true,
  }

  console.log('[/api/veille/sources] inserting:', { name, source_type })
  const created = await addSource(insert)
  if (!created) {
    return NextResponse.json({ error: 'Failed to insert source' }, { status: 500 })
  }

  console.log('[/api/veille/sources] created:', { id: created.id })
  return NextResponse.json({ source: created }, { status: 201 })
}
