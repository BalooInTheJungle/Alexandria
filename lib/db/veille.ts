// DB layer — veille_runs and veille_items

import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function createRun(): Promise<string> {
  console.log('[db/veille] Creating run')
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('veille_runs')
    .insert({ status: 'running', started_at: new Date().toISOString() })
    .select('id')
    .single()

  if (error) throw new Error(`[db/veille] createRun failed: ${error.message}`)
  console.log(`[db/veille] Run created: ${data.id}`)
  return data.id
}

export async function completeRun(runId: string, status: 'completed' | 'failed', errorMessage?: string) {
  console.log(`[db/veille] Completing run ${runId} → ${status}`)
  const supabase = getSupabase()
  const { error } = await supabase
    .from('veille_runs')
    .update({ status, completed_at: new Date().toISOString(), error_message: errorMessage ?? null })
    .eq('id', runId)

  if (error) console.error(`[db/veille] completeRun error:`, error.message)
}

// ── Deduplication ────────────────────────────────────────────────────────────

export async function getKnownDois(): Promise<Set<string>> {
  console.log('[db/veille] Loading known DOIs for dedup')
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('veille_items')
    .select('doi')
    .not('doi', 'is', null)

  if (error) {
    console.error('[db/veille] getKnownDois error:', error.message)
    return new Set()
  }

  const dois = new Set(data.map((r: any) => r.doi as string))
  console.log(`[db/veille] ${dois.size} known DOIs loaded`)
  return dois
}

// ── Items ─────────────────────────────────────────────────────────────────────

export interface VeilleItemInsert {
  run_id:       string
  source_id:    string
  url:          string
  title:        string
  authors:      string[]
  doi:          string | null
  abstract:     string | null
  published_at: string | null
  last_error:   string | null
}

export async function updateVeilleItemScores(scores: Map<string, number>): Promise<void> {
  if (scores.size === 0) return
  console.log(`[db/veille] Updating ${scores.size} similarity scores`)
  const supabase = getSupabase()

  for (const [id, similarity_score] of Array.from(scores)) {
    const { error } = await supabase
      .from('veille_items')
      .update({ similarity_score })
      .eq('id', id)
    if (error) console.error(`[db/veille] updateScore error for ${id}:`, error.message)
  }
}

export async function insertVeilleItems(items: VeilleItemInsert[]): Promise<number> {
  const inserted = await insertVeilleItemsWithIds(items)
  return inserted.length
}

// Insert items and return inserted rows with id + abstract (for scoring)
export async function insertVeilleItemsWithIds(
  items: VeilleItemInsert[]
): Promise<{ id: string; abstract: string | null }[]> {
  if (items.length === 0) return []
  console.log(`[db/veille] Inserting ${items.length} items`)
  const supabase = getSupabase()

  const inserted: { id: string; abstract: string | null }[] = []

  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50)
    const { data, error } = await supabase
      .from('veille_items')
      .insert(batch)
      .select('id, abstract')

    if (error) console.error(`[db/veille] insert batch error:`, error.message)
    else inserted.push(...(data ?? []))
  }

  console.log(`[db/veille] ${inserted.length}/${items.length} items inserted`)
  return inserted
}
