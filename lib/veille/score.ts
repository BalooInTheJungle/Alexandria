// Scores veille articles against the RAG corpus
// - similarity score: abstract split into chunks → embed each → match_chunks → max similarity
// - corpus_refs:      top-3 matching chunks with similarity >= CORPUS_REF_THRESHOLD (across all abstract chunks)
// - heuristic score:  count corpus stemmed terms found in abstract (fast, no embedding)
//
// Chunking rationale: all-MiniLM-L6-v2 is trained on short sentences. Embedding a full
// abstract (~400 words) into a single 384D vector loses too much information. Splitting
// into ~150-word chunks gives one precise vector per idea, improving recall and reducing
// false positives caused by generic journal-name matches.

import { createClient } from '@supabase/supabase-js'
import { embedQuery } from '../rag/embed'
import type { CorpusRef } from '../db/types'

const CORPUS_REF_THRESHOLD = 0.75  // min similarity to include a chunk as a corpus ref
const EXCERPT_MAX_CHARS     = 350   // max chars to keep from chunk content (~2-3 sentences)
const ABSTRACT_CHUNK_WORDS  = 150   // words per abstract chunk
const ABSTRACT_CHUNK_OVERLAP = 1    // sentences of overlap between consecutive chunks
const ABSTRACT_MAX_CHUNKS   = 4     // cap to avoid too many RPC calls per article

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type ScoreResult = {
  similarity: number | null
  authorSimilarity: number | null
  refs: CorpusRef[]
}

const MATCH_TIMEOUT_MS = 30_000  // abort match_chunks if no response in 30s

// Split an abstract into overlapping chunks of ~ABSTRACT_CHUNK_WORDS words.
// Uses sentence boundaries to avoid cutting mid-sentence.
function splitAbstractIntoChunks(abstract: string): string[] {
  const sentences = abstract
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)

  if (sentences.length <= 3) return [abstract]

  const chunks: string[] = []
  let i = 0

  while (i < sentences.length && chunks.length < ABSTRACT_MAX_CHUNKS) {
    const chunk: string[] = []
    let wordCount = 0

    // Add overlap: reuse last sentence of previous chunk
    if (i > 0 && ABSTRACT_CHUNK_OVERLAP > 0) {
      const overlapStart = Math.max(0, i - ABSTRACT_CHUNK_OVERLAP)
      for (let k = overlapStart; k < i; k++) {
        chunk.push(sentences[k])
        wordCount += sentences[k].split(/\s+/).length
      }
    }

    // Fill chunk up to ABSTRACT_CHUNK_WORDS words
    while (i < sentences.length && wordCount < ABSTRACT_CHUNK_WORDS) {
      chunk.push(sentences[i])
      wordCount += sentences[i].split(/\s+/).length
      i++
    }

    const text = chunk.join(' ').trim()
    if (text.length >= 40) chunks.push(text)
  }

  return chunks.length > 0 ? chunks : [abstract]
}

// Match one embedding against the corpus. Returns rows or null on timeout/error.
async function matchChunks(
  embedding: number[],
  rpcName: 'match_chunks' | 'match_author_chunks' = 'match_chunks'
): Promise<{ doc_title: string; content: string; page: number | null; similarity: number }[] | null> {
  const supabase = getSupabase()
  const rpcPromise = supabase.rpc(rpcName, {
    query_embedding: embedding,
    match_threshold: 0.0,
    match_count:     3,
  })
  const timeoutPromise = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error(`${rpcName} timeout`)), MATCH_TIMEOUT_MS)
  )

  try {
    const result = await Promise.race([rpcPromise, timeoutPromise]) as { data: unknown; error: unknown } | null
    if (!result) return null
    if (result.error) {
      console.error(`[score] ${rpcName} error:`, (result.error as any).message)
      return null
    }
    return (result.data as any[]) ?? []
  } catch {
    console.error(`[score] ${rpcName} timeout`)
    return null
  }
}

// Score a single abstract against the corpus.
// Splits abstract into chunks, embeds each, takes max similarity across chunks.
// corpus_refs = union of chunks with similarity >= CORPUS_REF_THRESHOLD across all abstract chunks.
async function scoreAbstract(abstract: string): Promise<ScoreResult> {
  try {
    const abstractChunks = splitAbstractIntoChunks(abstract)
    console.log(`[score] abstract split into ${abstractChunks.length} chunk(s)`)

    let bestSimilarity: number | null = null
    const allRefs: CorpusRef[] = []
    const seenExcerpts = new Set<string>()
    let anyTimeout = false

    let bestAuthorSimilarity: number | null = null

    for (const chunk of abstractChunks) {
      let embedding: number[]
      try {
        embedding = await embedQuery(chunk)
      } catch (embedErr: any) {
        console.error('[score] embedQuery failed:', embedErr.message)
        continue
      }

      // Run corpus + author scoring in parallel
      const [rows, authorRows] = await Promise.all([
        matchChunks(embedding, 'match_chunks'),
        matchChunks(embedding, 'match_author_chunks'),
      ])

      if (rows === null) {
        anyTimeout = true
      } else if (rows.length > 0) {
        const chunkSimilarity = typeof rows[0].similarity === 'number'
          ? Math.round(rows[0].similarity * 1000) / 1000
          : null
        if (chunkSimilarity !== null && (bestSimilarity === null || chunkSimilarity > bestSimilarity)) {
          bestSimilarity = chunkSimilarity
        }
        for (const row of rows) {
          if (row.similarity < CORPUS_REF_THRESHOLD) continue
          const key = `${row.doc_title}::${row.page}`
          if (seenExcerpts.has(key)) continue
          seenExcerpts.add(key)
          allRefs.push({
            doc_title:  row.doc_title ?? 'Document inconnu',
            excerpt:    row.content.length > EXCERPT_MAX_CHARS
              ? row.content.slice(0, EXCERPT_MAX_CHARS).trimEnd() + '…'
              : row.content,
            page:       row.page ?? null,
            similarity: Math.round(row.similarity * 1000) / 1000,
          })
        }
      }

      if (authorRows !== null && authorRows.length > 0) {
        const authorSim = typeof authorRows[0].similarity === 'number'
          ? Math.round(authorRows[0].similarity * 1000) / 1000
          : null
        if (authorSim !== null && (bestAuthorSimilarity === null || authorSim > bestAuthorSimilarity)) {
          bestAuthorSimilarity = authorSim
        }
      }
    }

    // If all chunks timed out, return null to mark as "not scored"
    if (anyTimeout && bestSimilarity === null) {
      return { similarity: null, authorSimilarity: null, refs: [] }
    }

    return {
      similarity:       bestSimilarity,
      authorSimilarity: bestAuthorSimilarity,
      refs:             allRefs.sort((a, b) => b.similarity - a.similarity).slice(0, 5),
    }
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

const SCORE_CONCURRENCY = Number(process.env.SCORE_CONCURRENCY ?? 5)

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
