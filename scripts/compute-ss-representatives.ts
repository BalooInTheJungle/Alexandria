#!/usr/bin/env ts-node
/**
 * scripts/compute-ss-representatives.ts
 *
 * Calcule les articles auteur les plus représentatifs du corpus (centroïde embeddings),
 * résout leurs paperIds sur Semantic Scholar, et stocke le résultat dans
 * ss_representative_papers pour être utilisé par le pipeline veille quotidien.
 *
 * À relancer après chaque : npx tsx scripts/veille/ingest.py --author
 *
 * Usage : npx tsx --project tsconfig.scripts.json scripts/compute-ss-representatives.ts
 * Env vars :
 *   NEXT_PUBLIC_SUPABASE_URL     — URL Supabase
 *   SUPABASE_SERVICE_ROLE_KEY    — clé service role
 *   SS_REPRESENTATIVE_TITLES     — (optionnel) nombre de titres (défaut: 15)
 */

import { createClient } from '@supabase/supabase-js'

const SS_SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search'
const TOP_TITLES    = parseInt(process.env.SS_REPRESENTATIVE_TITLES ?? '15', 10)
const SS_DELAY_MS   = 600

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant')
  return createClient(url, key)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function loadRepresentativeTitles(): Promise<{ title: string; distance: number }[]> {
  const sb = getSupabase()
  console.log(`\n📐 Calcul centroïde sur chunks auteur (top ${TOP_TITLES})…`)
  console.log('   (peut prendre ~60s)')

  const { data, error } = await sb.rpc('get_author_representative_titles', { top_n: TOP_TITLES })
  if (error) throw new Error(`RPC get_author_representative_titles: ${error.message}`)

  const results = (data as { title: string; distance: number }[])
  console.log(`✓ ${results.length} titres trouvés`)
  return results
}

async function resolvePaperId(title: string): Promise<string | null> {
  const url = `${SS_SEARCH_URL}?query=${encodeURIComponent(title)}&limit=1&fields=paperId,title`
  const res  = await fetch(url)
  if (!res.ok) {
    console.warn(`  ⚠️  SS search HTTP ${res.status} pour "${title.slice(0, 60)}"`)
    return null
  }
  const json = await res.json()
  return (json.data?.[0]?.paperId as string) ?? null
}

async function main() {
  const sb = getSupabase()

  // Étape 1 : centroïde → titres
  const titles = await loadRepresentativeTitles()

  // Étape 2 : résoudre les paperIds SS
  console.log('\n🔍 Résolution des paperIds sur Semantic Scholar…')
  const rows: { title: string; distance: number; ss_paper_id: string | null }[] = []

  for (const { title, distance } of titles) {
    const id = await resolvePaperId(title)
    console.log(id
      ? `  ✓ ${title.slice(0, 70)} → ${id}`
      : `  ✗ ${title.slice(0, 70)} (non trouvé)`
    )
    rows.push({ title, distance, ss_paper_id: id })
    await sleep(SS_DELAY_MS)
  }

  const resolved = rows.filter(r => r.ss_paper_id).length
  console.log(`\n✓ ${resolved}/${rows.length} paperIds résolus`)

  // Étape 3 : remplace toute la table (truncate + insert)
  console.log('\n💾 Sauvegarde en base…')
  await sb.from('ss_representative_papers').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  const { error } = await sb.from('ss_representative_papers').insert(
    rows.map(r => ({ title: r.title, distance: r.distance, ss_paper_id: r.ss_paper_id }))
  )
  if (error) throw new Error(`Insert ss_representative_papers: ${error.message}`)

  console.log(`✅ ${rows.length} entrées sauvegardées dans ss_representative_papers`)
  console.log('\n💡 Relancer après chaque : python3 scripts/ingest.py --author\n')
}

main().catch(err => {
  console.error(`\n❌ Erreur: ${err.message}`)
  process.exit(1)
})
