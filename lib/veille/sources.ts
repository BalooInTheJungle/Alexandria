// Fetch RSS sources from Supabase (only sources with source_type = 'rss')

import { createClient } from '@supabase/supabase-js'
import type { RssSource } from './fetch-rss'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export interface OpenAlexSource {
  id:        string
  name:      string
  publisher: string
  issn:      string
}

export async function getOpenAlexSources(): Promise<OpenAlexSource[]> {
  console.log('[getOpenAlexSources] Loading OpenAlex sources from DB')
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('sources')
    .select('id, name, publisher, issn')
    .eq('source_type', 'openalex')
    .eq('active', true)
    .not('issn', 'is', null)

  if (error) {
    console.error('[getOpenAlexSources] Error:', error.message)
    return []
  }
  console.log(`[getOpenAlexSources] ${data.length} OpenAlex sources loaded`)
  return data as OpenAlexSource[]
}

export async function getRssSources(): Promise<RssSource[]> {
  console.log('[getRssSources] Loading sources from DB')
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('sources')
    .select('id, name, publisher, issn, rss_url')
    .eq('source_type', 'rss')
    .eq('active', true)
    .not('rss_url', 'is', null)

  if (error) {
    console.error('[getRssSources] Error:', error.message)
    return []
  }

  console.log(`[getRssSources] ${data.length} RSS sources loaded`)
  return data as RssSource[]
}
