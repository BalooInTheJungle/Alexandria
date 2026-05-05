// Scores veille articles against the RAG corpus
// - similarity score: embed abstract → match_chunks cosine similarity (top-1 score)
// - corpus_refs:      top-3 matching chunks with similarity >= CORPUS_REF_THRESHOLD
// - heuristic score:  count corpus stemmed terms found in abstract (fast, no embedding)

import { createClient } from '@supabase/supabase-js'
import { embedQuery } from '../rag/embed'
import type { CorpusRef } from '../db/types'

const CORPUS_REF_THRESHOLD = 0.75  // min similarity to include a chunk as a corpus ref
const EXCERPT_MAX_CHARS     = 350   // max chars to keep from chunk content (~2-3 sentences)

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type ScoreResult = {
  similarity: number | null
  refs: CorpusRef[]
}

// Score a single abstract against the corpus.
// Returns top-1 similarity score and up to 3 corpus refs (similarity >= CORPUS_REF_THRESHOLD).
async function scoreAbstract(abstract: string): Promise<ScoreResult> {
  try {
    const embedding = await embedQuery(abstract)
    const supabase  = getSupabase()

    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding:  embedding,
      match_threshold:  0.0,
      match_count:      3,
    })

    if (error) {
      console.error('[score] match_chunks error:', error.message)
      return { similarity: null, refs: [] }
    }

    if (!data || data.length === 0) return { similarity: null, refs: [] }

    const similarity = typeof data[0].similarity === 'number'
      ? Math.round(data[0].similarity * 1000) / 1000
      : null

    const refs: CorpusRef[] = (data as {
      doc_title: string; content: string; page: number | null; similarity: number
    }[])
      .filter(row => row.similarity >= CORPUS_REF_THRESHOLD)
      .map(row => ({
        doc_title:  row.doc_title ?? 'Document inconnu',
        excerpt:    row.content.length > EXCERPT_MAX_CHARS
          ? row.content.slice(0, EXCERPT_MAX_CHARS).trimEnd() + '…'
          : row.content,
        page:       row.page ?? null,
        similarity: Math.round(row.similarity * 1000) / 1000,
      }))

    return { similarity, refs }
  } catch (err: any) {
    console.error('[score] Error:', err.message)
    return { similarity: null, refs: [] }
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

// Score all items that have an abstract.
// Returns map of id → { similarity, refs }
// onProgress is called every 50 items with (processed, total) for live reporting.
export async function scoreVeilleItems(
  items: { id: string; abstract: string | null }[],
  onProgress?: (processed: number, total: number) => Promise<void>
): Promise<Map<string, ScoreResult>> {
  const withAbstract = items.filter(i => i.abstract && i.abstract.length > 50)
  console.log(`[score] Scoring ${withAbstract.length}/${items.length} items (with abstract)`)

  const scores = new Map<string, ScoreResult>()
  let processed = 0

  for (const item of withAbstract) {
    const result = await scoreAbstract(item.abstract!)
    scores.set(item.id, result)
    console.log(`[score] ${item.id.slice(0, 8)}… → similarity=${result.similarity} refs=${result.refs.length}`)

    processed++
    if (onProgress && processed % 50 === 0) {
      await onProgress(processed, withAbstract.length)
    }
  }

  console.log(`[score] Done — ${scores.size}/${withAbstract.length} scored`)
  return scores
}
