// GET /api/documents — list indexed PDFs ordered by created_at desc

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  console.log('[GET /api/documents] request received')

  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('documents')
    .select('id, title, authors, doi, journal, published_at, storage_path, status, error_message, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[GET /api/documents] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log('[GET /api/documents] result:', { count: data?.length ?? 0 })
  return NextResponse.json({ documents: data ?? [] })
}
