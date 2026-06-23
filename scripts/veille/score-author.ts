#!/usr/bin/env ts-node
/**
 * scripts/veille/score-author.ts
 *
 * Calcule author_score pour tous les veille_items existants qui ont un abstract
 * mais pas encore d'author_score.
 *
 * Usage :
 *   export $(grep -v '^#' .env.local | xargs)
 *   npx tsx scripts/veille/score-author.ts
 *
 * Options :
 *   --all    Recalcule même les items qui ont déjà un author_score
 *   --limit  Nombre max d'items à traiter (défaut : 2000)
 */

import { createClient } from '@supabase/supabase-js'
import { embedQuery } from '../../lib/rag/embed'

const CONCURRENCY = 5
const MATCH_TIMEOUT_MS = 30_000
const ALL = process.argv.includes('--all')
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='))
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 2000

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
  return createClient(url, key)
}

async function matchAuthorChunks(embedding: number[]): Promise<number | null> {
  const sb = getSupabase()
  const rpcPromise = sb.rpc('match_author_chunks', {
    query_embedding: embedding,
    match_threshold: 0.0,
    match_count: 3,
  })
  const timeoutPromise = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), MATCH_TIMEOUT_MS)
  )
  try {
    const result = await Promise.race([rpcPromise, timeoutPromise]) as { data: unknown; error: unknown } | null
    if (!result || (result as any).error) return null
    const rows = (result as any).data as { similarity: number }[]
    if (!rows || rows.length === 0) return null
    return Math.round(rows[0].similarity * 1000) / 1000
  } catch {
    return null
  }
}

async function scoreItem(item: { id: string; abstract: string }): Promise<number | null> {
  try {
    const embedding = await embedQuery(item.abstract)
    return await matchAuthorChunks(embedding)
  } catch {
    return null
  }
}

async function main() {
  const sb = getSupabase()

  console.log(`\n🎯 score-author — mode: ${ALL ? 'recalcul complet' : 'manquants uniquement'}, limit=${LIMIT}\n`)

  let query = sb
    .from('veille_items')
    .select('id, abstract')
    .not('abstract', 'is', null)
    .not('similarity_score', 'is', null)
    .limit(LIMIT)

  if (!ALL) query = query.is('author_score', null)

  const { data: items, error } = await query
  if (error) throw new Error(`Fetch failed: ${error.message}`)

  const withAbstract = (items ?? []).filter(i => i.abstract && i.abstract.length > 50)
  console.log(`📋 ${withAbstract.length} articles à scorer\n`)

  if (withAbstract.length === 0) {
    console.log('✅ Rien à faire — tous les articles ont déjà un author_score.')
    return
  }

  let done = 0
  let saved = 0

  for (let i = 0; i < withAbstract.length; i += CONCURRENCY) {
    const batch = withAbstract.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(item => scoreItem(item as { id: string; abstract: string })))

    await Promise.all(batch.map(async (item, j) => {
      const score = results[j]
      done++
      const pct = score !== null ? `${Math.round(score * 100)}%` : 'null'
      process.stdout.write(`   [${done}/${withAbstract.length}] id=${item.id.slice(0, 8)}… author_score=${pct}\n`)

      const { error: updateErr } = await sb
        .from('veille_items')
        .update({ author_score: score })
        .eq('id', item.id)
      if (updateErr) {
        console.error(`   ❌ update error: ${updateErr.message}`)
      } else {
        saved++
      }
    }))
  }

  console.log(`\n✅ Terminé — ${saved}/${withAbstract.length} articles mis à jour avec author_score\n`)
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('FATAL:', err.message)
    process.exit(1)
  })
