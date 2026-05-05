// Test complet de la pipeline veille — à lancer manuellement avant tout déploiement
// Usage : npx tsx scripts/test-veille.ts
//
// Ce script vérifie chaque couche indépendamment (sans insérer en DB) :
//   [1] Connexion Supabase — variables d'env présentes et DB joignable
//   [2] Sources DB — RSS et OpenAlex chargées
//   [3] RSS — 3 sources représentatives (RSC, ACS, Wiley)
//   [4] Filtre date — articles récents isolés correctement
//   [5] OpenAlex batch — abstracts récupérés en batch
//   [6] OpenAlex ISSN — source MDPI (OpenAlex only)
//   [7] Score — embedding + similarity sur un abstract de test

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(process.cwd(), '.env.local')
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const [key, ...rest] = line.split('=')
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
}

import { createClient } from '@supabase/supabase-js'
import { getRssSources, getOpenAlexSources } from '../lib/veille/sources'
import { fetchRssFeed } from '../lib/veille/fetch-rss'
import { fetchAbstractsByDois, fetchRecentByIssn } from '../lib/veille/openalex'
import { scoreVeilleItems } from '../lib/veille/score'

const LOOKBACK_DAYS = 7

function isRecent(published_at: string | null): boolean {
  if (!published_at) return true
  return Date.now() - new Date(published_at).getTime() < LOOKBACK_DAYS * 86400000
}

function ok(msg: string) { console.log(`  ✅ ${msg}`) }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`) }
function fail(msg: string) { console.log(`  ❌ ${msg}`); process.exitCode = 1 }

// ─────────────────────────────────────────────────────────────────────────────
// [1] Connexion Supabase
// ─────────────────────────────────────────────────────────────────────────────
async function testSupabaseConnection() {
  console.log('\n[1] Connexion Supabase')
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']
  for (const key of required) {
    if (!process.env[key]) { fail(`Variable manquante : ${key}`); return false }
  }
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { error } = await supabase.from('sources').select('id').limit(1)
  if (error) { fail(`DB inaccessible : ${error.message}`); return false }
  ok('Supabase accessible')
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Sources DB
// ─────────────────────────────────────────────────────────────────────────────
async function testSources() {
  console.log('\n[2] Sources DB')
  const rss = await getRssSources()
  const oalex = await getOpenAlexSources()

  if (rss.length === 0) fail('Aucune source RSS en DB')
  else ok(`${rss.length} sources RSS chargées`)

  if (oalex.length === 0) warn('Aucune source OpenAlex en DB (optionnel)')
  else ok(`${oalex.length} sources OpenAlex chargées`)

  // Vérifier que les champs obligatoires sont présents
  const invalid = rss.filter(s => !s.issn || !s.rss_url)
  if (invalid.length > 0) fail(`${invalid.length} sources RSS sans issn ou rss_url : ${invalid.map(s => s.name).join(', ')}`)
  else ok('Toutes les sources RSS ont issn + rss_url')

  return { rss, oalex }
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] RSS — 3 sources représentatives
// ─────────────────────────────────────────────────────────────────────────────
async function testRss(rssSources: Awaited<ReturnType<typeof getRssSources>>) {
  console.log('\n[3] RSS — 3 sources représentatives')

  // Pick one per publisher family for coverage
  const targets = ['RSC', 'ACS', 'Wiley']
  const tested: string[] = []

  for (const publisher of targets) {
    const source = rssSources.find(s => s.publisher === publisher)
    if (!source) { warn(`Aucune source ${publisher} en DB`); continue }

    const articles = await fetchRssFeed(source)
    if (articles.length === 0) {
      fail(`${source.name} (${publisher}) : 0 articles retournés`)
      continue
    }

    const withDoi = articles.filter(a => a.doi).length
    const withAbstract = articles.filter(a => a.abstract).length
    const recent = articles.filter(a => isRecent(a.published_at)).length

    if (withDoi === 0) warn(`${source.name} : 0 DOIs — enrichissement OpenAlex nécessaire`)
    else ok(`${source.name} : ${articles.length} articles, ${withDoi} DOI, ${withAbstract} abstract, ${recent} récents (${LOOKBACK_DAYS}j)`)

    tested.push(publisher)
    await new Promise(r => setTimeout(r, 500))
  }

  if (tested.length < 2) fail('Moins de 2 sources RSS fonctionnelles — vérifier les URLs RSS en DB')
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Filtre date — isRecent
// ─────────────────────────────────────────────────────────────────────────────
function testDateFilter() {
  console.log('\n[4] Filtre date')
  const yesterday = new Date(Date.now() - 86400000).toISOString()
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()

  if (!isRecent(yesterday))  { fail('Hier devrait être considéré récent'); return }
  if (isRecent(tenDaysAgo))  { fail('Il y a 10 jours ne devrait pas être récent'); return }
  if (!isRecent(null))       { fail('Date null devrait être conservée'); return }
  ok('Filtre 7 jours correct (hier=récent, 10j=ignoré, null=gardé)')
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] OpenAlex batch — abstracts par DOIs
// ─────────────────────────────────────────────────────────────────────────────
async function testOpenAlexBatch(rssSources: Awaited<ReturnType<typeof getRssSources>>) {
  console.log('\n[5] OpenAlex batch abstracts')

  // Grab real DOIs from an ACS source (which has DOIs but no abstracts in RSS)
  const acs = rssSources.find(s => s.publisher === 'ACS')
  if (!acs) { warn('Pas de source ACS — skip batch test'); return }

  const articles = await fetchRssFeed(acs)
  const dois = articles
    .filter(a => a.doi && !a.abstract)
    .map(a => a.doi!)
    .slice(0, 5)  // test with 5 DOIs max

  if (dois.length === 0) { warn('Aucun DOI sans abstract pour tester le batch'); return }

  console.log(`  Testing batch with ${dois.length} DOIs from ${acs.name}`)
  const map = await fetchAbstractsByDois(dois)

  const found = Array.from(map.values()).filter(Boolean).length
  if (found === 0) fail(`OpenAlex batch : 0 abstracts trouvés sur ${dois.length} DOIs`)
  else ok(`OpenAlex batch : ${found}/${dois.length} abstracts récupérés`)
}

// ─────────────────────────────────────────────────────────────────────────────
// [6] OpenAlex ISSN — source OpenAlex-only (MDPI)
// ─────────────────────────────────────────────────────────────────────────────
async function testOpenAlexIssn(openAlexSources: Awaited<ReturnType<typeof getOpenAlexSources>>) {
  console.log('\n[6] OpenAlex ISSN (sources sans RSS)')
  if (openAlexSources.length === 0) { warn('Aucune source OpenAlex en DB — skip'); return }

  const source = openAlexSources[0]
  const articles = await fetchRecentByIssn(source.issn, LOOKBACK_DAYS)

  if (articles.length === 0) warn(`${source.name} : 0 articles récents (normal si semaine creuse)`)
  else {
    const withAbstract = articles.filter(a => a.abstract).length
    ok(`${source.name} : ${articles.length} articles, ${withAbstract} avec abstract`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [7] Score — embedding + similarity
// ─────────────────────────────────────────────────────────────────────────────
async function testScore() {
  console.log('\n[7] Score — embedding + similarity corpus')
  const fakeItems = [{
    id: 'test-id-001',
    abstract: 'Single-molecule magnets based on lanthanide complexes show high magnetic anisotropy and slow magnetic relaxation, making them promising candidates for quantum information processing applications.',
  }]

  const scores = await scoreVeilleItems(fakeItems)

  if (scores.size === 0) warn('Score retourné vide — corpus peut-être vide ou embeddings non initialisés')
  else {
    const result = scores.get('test-id-001') ?? null
    const score = result?.similarity ?? null
    ok(`Score calculé : ${score} (item test vs corpus, refs=${result?.refs.length ?? 0})`)
    if (score !== null && score < 0) fail('Score négatif inattendu')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  TEST VEILLE PIPELINE — Alexandria')
  console.log('═══════════════════════════════════════════')

  const dbOk = await testSupabaseConnection()
  if (!dbOk) { console.log('\nAbort — DB inaccessible\n'); process.exit(1) }

  const { rss, oalex } = await testSources()
  testDateFilter()
  await testRss(rss)
  await testOpenAlexBatch(rss)
  await testOpenAlexIssn(oalex)
  await testScore()

  console.log('\n═══════════════════════════════════════════')
  if (process.exitCode === 1) {
    console.log('  RÉSULTAT : ❌ Des tests ont échoué')
  } else {
    console.log('  RÉSULTAT : ✅ Tous les tests OK')
  }
  console.log('═══════════════════════════════════════════\n')
}

main().catch(err => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
