import { createClient } from '@/lib/supabase/server'
import type { Source, SourceInsert } from './types'

export async function getSources(): Promise<Source[]> {
  console.log('[getSources] input: none')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sources')
    .select('id, name, publisher, issn, url, rss_url, source_type, active, created_at, last_checked_at')
    .order('publisher', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })

  if (error) {
    console.error('[getSources] error:', error.message)
    return []
  }
  console.log('[getSources] result:', { count: data.length })
  return data as Source[]
}

export async function toggleSourceActive(id: string, active: boolean): Promise<boolean> {
  console.log('[toggleSourceActive] input:', { id, active })
  const supabase = await createClient()
  const { error } = await supabase
    .from('sources')
    .update({ active })
    .eq('id', id)

  if (error) {
    console.error('[toggleSourceActive] error:', error.message)
    return false
  }
  console.log('[toggleSourceActive] result:', { id, active })
  return true
}

export async function addSource(source: SourceInsert): Promise<Source | null> {
  console.log('[addSource] input:', { name: source.name, source_type: source.source_type })
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('sources')
    .insert(source)
    .select()
    .single()

  if (error) {
    console.error('[addSource] error:', error.message)
    return null
  }
  console.log('[addSource] result:', { id: data.id, name: data.name })
  return data as Source
}
