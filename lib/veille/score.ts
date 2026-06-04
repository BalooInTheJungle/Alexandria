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

const MATCH_TIMEOUT_MS = 8000  // abort match_chunks if no response in 8s

// Score a single abstract against the corpus.
// Returns top-1 similarity score and up to 3 corpus refs (similarity >= CORPUS_REF_THRESHOLD).
async function scoreAbstract(abstract: string): Promise<ScoreResult> {
  try {
    const embedding = await embedQuery(abstract)
    const supabase  = getSupabase()

    const rpcPromise = supabase.rpc('match_chunks', {
      query_embedding:  embedding,
      match_threshold:  0.0,
      match_count:      3,
    })
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('match_chunks timeout')), MATCH_TIMEOUT_MS)
    )

    let data: unknown, error: unknown
    try {
      const result = await Promise.race([rpcPromise, timeoutPromise]) as { data: unknown; error: unknown }
      data = result?.data
      error = result?.error
    } catch (timeoutErr: any) {
      console.error('[score] match_chunks timeout — returning null similarity')
      return { similarity: null, refs: [] }
    }

    if (error) {
      console.error('[score] match_chunks error:', (error as any).message)
      return { similarity: null, refs: [] }
    }

    if (!data || (data as unknown[]).length === 0) return { similarity: null, refs: [] }

    const rows = data as { doc_title: string; content: string; page: number | null; similarity: number }[]
    const similarity = typeof rows[0].similarity === 'number'
      ? Math.round(rows[0].similarity * 1000) / 1000
      : null

    const refs: CorpusRef[] = (rows as {
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

const SCORE_CONCURRENCY = 5   // parallel scoring workers — reduced to avoid Supabase overload

// Score all items that have an abstract, using parallel batches.
// onProgress is called every 10 items with (processed, total) for live reporting.
export async function scoreVeilleItems(
  items: { id: string; abstract: string | null }[],
  onProgress?: (processed: number, total: number) => Promise<void>
): Promise<Map<string, ScoreResult>> {
  const withAbstract = items.filter(i => i.abstract && i.abstract.length > 50)
  const total = withAbstract.length
  console.log(`[score] Scoring ${total}/${items.length} items (with abstract) — concurrency=${SCORE_CONCURRENCY}`)

  const scores = new Map<string, ScoreResult>()
  let processed = 0
  const startTs = Date.now()

  for (let i = 0; i < withAbstract.length; i += SCORE_CONCURRENCY) {
    const batch = withAbstract.slice(i, i + SCORE_CONCURRENCY)
    const results = await Promise.all(batch.map(item => scoreAbstract(item.abstract!)))

    batch.forEach((item, j) => {
      const result = results[j]
      scores.set(item.id, result)
      processed++
      const elapsed = Math.round((Date.now() - startTs) / 1000)
      console.log(`[score] ${processed}/${total} — id=${item.id.slice(0, 8)}… similarity=${result.similarity} refs=${result.refs.length} elapsed=${elapsed}s`)
    })

    if (onProgress && processed % 10 === 0) {
      await onProgress(processed, total)
    }
  }

  const totalElapsed = Math.round((Date.now() - startTs) / 1000)
  console.log(`[score] Done — ${scores.size}/${total} scored in ${totalElapsed}s`)
  return scores
}
