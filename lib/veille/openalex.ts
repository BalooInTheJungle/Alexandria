// OpenAlex API client — fetches article metadata when RSS is incomplete
// 3 use cases:
//   1. Nature  : has DOI from RSS → fetch abstract by DOI
//   2. Elsevier: has abstract from RSS → fetch DOI by title + ISSN
//   3. MDPI    : nothing → fetch all recent articles by ISSN
// Docs: https://docs.openalex.org/api-entities/works

const OPENALEX_BASE = 'https://api.openalex.org/works'
const MAILTO = 'carel.clogenson@epitech.digital'
const HEADERS = {
  'User-Agent': `Alexandria/1.0 (mailto:${MAILTO})`,
}
const BATCH_SIZE = 50
const BATCH_DELAY_MS = 300

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export interface OpenAlexArticle {
  doi:          string | null
  title:        string
  authors:      string[]
  journal:      string | null
  published_at: string | null
  abstract:     string | null
  is_final:     boolean
}

// Reconstruct abstract from OpenAlex inverted index format
// OpenAlex stores abstracts as { word: [position1, position2, ...] }
function reconstructAbstract(invertedIndex: Record<string, number[]> | null | undefined): string | null {
  if (!invertedIndex) return null
  const words: string[] = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word
  }
  const result = words.filter(Boolean).join(' ').trim()
  return result.length > 20 ? result.slice(0, 2000) : null
}

// An article is "final" (assigned to a real journal issue) when:
// - OpenAlex type is 'article' AND
// - biblio has a volume OR a first_page assigned (ASAP articles lack both)
function isFinalPublication(work: any): boolean {
  if (work.type !== 'article') return false
  const biblio = work.biblio ?? {}
  return !!(biblio.volume || biblio.first_page)
}

function parseWork(work: any): OpenAlexArticle {
  const doi = work.doi ? work.doi.replace('https://doi.org/', '') : null
  const title = work.title ?? ''
  const authors = (work.authorships ?? [])
    .map((a: any) => a.author?.display_name)
    .filter(Boolean)
  const journal = work.primary_location?.source?.display_name ?? null
  const published_at = work.publication_date ?? null
  const abstract = reconstructAbstract(work.abstract_inverted_index)
  const is_final = isFinalPublication(work)

  return { doi, title, authors, journal, published_at, abstract, is_final }
}

async function fetchOpenAlex(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      console.error(`[openalex] HTTP ${res.status}: ${url}`)
      return null
    }
    return await res.json()
  } catch (err: any) {
    console.error(`[openalex] Network error:`, err.message)
    return null
  }
}

// Case 1 — Nature: fetch abstract by DOI
export async function fetchAbstractByDoi(doi: string): Promise<string | null> {
  console.log(`[openalex] Fetching abstract for DOI: ${doi}`)
  const url = `${OPENALEX_BASE}/doi:${encodeURIComponent(doi)}?select=abstract_inverted_index&mailto=${MAILTO}`
  const data = await fetchOpenAlex(url)
  if (!data) return null
  const abstract = reconstructAbstract(data.abstract_inverted_index)
  console.log(`[openalex] Abstract: ${abstract ? 'found (' + abstract.length + ' chars)' : 'not found'}`)
  return abstract
}

// Case 2 — Elsevier: fetch DOI by title + ISSN
export async function fetchDoiByTitle(title: string, issn: string): Promise<string | null> {
  console.log(`[openalex] Fetching DOI by title for ISSN ${issn}: "${title.slice(0, 50)}..."`)
  const query = encodeURIComponent(title)
  const url = `${OPENALEX_BASE}?filter=locations.source.issn:${issn}&search=${query}&select=doi,title&per-page=1&mailto=${MAILTO}`
  const data = await fetchOpenAlex(url)
  if (!data?.results?.[0]?.doi) return null
  const doi = data.results[0].doi.replace('https://doi.org/', '')
  console.log(`[openalex] DOI found: ${doi}`)
  return doi
}

export interface AbstractResult {
  abstract:  string | null
  is_final:  boolean
}

// Batch fetch abstracts for up to BATCH_SIZE DOIs per request
// Returns map of doi → { abstract, is_final }
// is_final = OpenAlex type is 'article' AND has a known journal source
export async function fetchAbstractsByDois(dois: string[]): Promise<Map<string, AbstractResult>> {
  const result = new Map<string, AbstractResult>()
  if (dois.length === 0) return result

  for (let i = 0; i < dois.length; i += BATCH_SIZE) {
    const batch = dois.slice(i, i + BATCH_SIZE)
    // OpenAlex pipe = OR operator; DOIs stay unencoded (only contain safe chars)
    const filterValue = batch.join('|')
    const url = `${OPENALEX_BASE}?filter=doi:${filterValue},type:article&select=doi,abstract_inverted_index,type,biblio&per-page=${BATCH_SIZE}&mailto=${MAILTO}`
    console.log(`[openalex] Batch abstract fetch: ${batch.length} DOIs (offset ${i})`)

    const data = await fetchOpenAlex(url)
    if (data?.results) {
      for (const work of data.results) {
        if (!work.doi) continue
        const doi = work.doi.replace('https://doi.org/', '')
        result.set(doi, {
          abstract: reconstructAbstract(work.abstract_inverted_index),
          is_final: isFinalPublication(work),
        })
      }
    }
    const found = Array.from(result.values()).filter(v => v.abstract).length
    const finals = Array.from(result.values()).filter(v => v.is_final).length
    console.log(`[openalex] Batch result: ${data?.results?.length ?? 0} works, ${found}/${result.size} with abstract, ${finals} journal articles`)

    if (i + BATCH_SIZE < dois.length) await sleep(BATCH_DELAY_MS)
  }

  return result
}

// Case 3 — MDPI: fetch recent articles by ISSN
export async function fetchRecentByIssn(issn: string, daysBack = 7): Promise<OpenAlexArticle[]> {
  const fromDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0]
  console.log(`[openalex] Fetching recent articles for ISSN ${issn} since ${fromDate}`)

  const url = `${OPENALEX_BASE}?filter=locations.source.issn:${issn},from_publication_date:${fromDate},type:article&select=doi,title,authorships,primary_location,publication_date,abstract_inverted_index,biblio&per-page=50&mailto=${MAILTO}`
  const data = await fetchOpenAlex(url)
  if (!data?.results) return []

  const articles = data.results.map(parseWork)
  console.log(`[openalex] ISSN ${issn}: ${articles.length} articles, ${articles.filter((a: OpenAlexArticle) => a.abstract).length} with abstract`)
  return articles
}
