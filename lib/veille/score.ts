// Scores veille articles against the RAG corpus
// - similarity score: embed abstract → match_chunks cosine similarity
// - heuristic score:  count corpus stemmed terms found in abstract (fast, no embedding)

import { createClient } from '@supabase/supabase-js'
import { embedQuery } from '../rag/embed'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Score a single abstract against the corpus — returns similarity 0–1
async function scoreAbstract(abstract: string): Promise<number | null> {
  try {
    const embedding = await embedQuery(abstract)
    const supabase  = getSupabase()

    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding:  embedding,
      match_threshold:  0.0,
      match_count:      1,
    })

    if (error) {
      console.error('[score] match_chunks error:', error.message)
      return null
    }

    const score = data?.[0]?.similarity ?? null
    return typeof score === 'number' ? Math.round(score * 1000) / 1000 : null
  } catch (err: any) {
    console.error('[score] Error:', err.message)
    return null
  }
}

// Load top N stemmed terms from the corpus cache
export async function loadCorpusTerms(lim = 80): Promise<string[]> {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase.rpc('get_corpus_top_terms', { lim })
    if (error) {
      console.error('[score] loadCorpusTerms error:', error.message)
      return []
    }
    const terms = (data ?? []).map((r: { word: string }) => r.word).filter(Boolean) as string[]
    console.log(`[score] loadCorpusTerms: ${terms.length} terms loaded`)
    return terms
  } catch (err: any) {
    console.error('[score] loadCorpusTerms exception:', err.message)
    return []
  }
}

// Heuristic score: fraction of corpus stemmed terms found as substrings in abstract (0–1)
export function scoreHeuristic(abstract: string, corpusTerms: string[]): number {
  if (!abstract || corpusTerms.length === 0) return 0
  const lower = abstract.toLowerCase()
  const matched = corpusTerms.filter(term => lower.includes(term)).length
  return Math.round((matched / corpusTerms.length) * 1000) / 1000
}

// Score all items that have an abstract — returns map of id → score
// onProgress is called every 50 items with (processed, total) for live reporting
export async function scoreVeilleItems(
  items: { id: string; abstract: string | null }[],
  onProgress?: (processed: number, total: number) => Promise<void>
): Promise<Map<string, number>> {
  const withAbstract = items.filter(i => i.abstract && i.abstract.length > 50)
  console.log(`[score] Scoring ${withAbstract.length}/${items.length} items (with abstract)`)

  const scores = new Map<string, number>()
  let processed = 0

  for (const item of withAbstract) {
    const score = await scoreAbstract(item.abstract!)
    if (score !== null) {
      scores.set(item.id, score)
      console.log(`[score] ${item.id.slice(0, 8)}… → ${score}`)
    }
    processed++
    if (onProgress && processed % 50 === 0) {
      await onProgress(processed, withAbstract.length)
    }
  }

  console.log(`[score] Done — ${scores.size}/${withAbstract.length} scored`)
  return scores
}
