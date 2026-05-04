// Scores veille articles by similarity against the RAG corpus
// Embeds the abstract and calls match_chunks RPC to get best cosine similarity

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

// Score all items that have an abstract — returns map of id → score
export async function scoreVeilleItems(
  items: { id: string; abstract: string | null }[]
): Promise<Map<string, number>> {
  const withAbstract = items.filter(i => i.abstract && i.abstract.length > 50)
  console.log(`[score] Scoring ${withAbstract.length}/${items.length} items (with abstract)`)

  const scores = new Map<string, number>()

  for (const item of withAbstract) {
    const score = await scoreAbstract(item.abstract!)
    if (score !== null) {
      scores.set(item.id, score)
      console.log(`[score] ${item.id.slice(0, 8)}… → ${score}`)
    }
  }

  console.log(`[score] Done — ${scores.size}/${withAbstract.length} scored`)
  return scores
}
