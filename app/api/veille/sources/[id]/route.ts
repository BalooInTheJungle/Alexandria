// PATCH /api/veille/sources/[id] — activer ou désactiver une source
// body: { active: boolean }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toggleSourceActive } from '@/lib/db/sources'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { id } = params
  console.log('[/api/veille/sources/[id]] PATCH input:', { id })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { active?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.active !== 'boolean') {
    return NextResponse.json({ error: 'active (boolean) is required' }, { status: 400 })
  }

  const ok = await toggleSourceActive(id, body.active)
  if (!ok) {
    return NextResponse.json({ error: 'Failed to update source' }, { status: 500 })
  }

  console.log('[/api/veille/sources/[id]] result:', { id, active: body.active })
  return NextResponse.json({ id, active: body.active })
}
