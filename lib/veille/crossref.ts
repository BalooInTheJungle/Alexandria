// CrossRef API client — finalization check fallback when OpenAlex biblio is missing
// CrossRef is the DOI registration authority: most reliable source for volume/issue/page.
// No batch endpoint → sequential calls, only used on a small subset (OpenAlex rejects).
// Docs: https://api.crossref.org/swagger-ui/index.html

const CROSSREF_BASE = 'https://api.crossref.org/works'
const MAILTO = 'carel.clogenson@epitech.digital'
const HEADERS = {
  'User-Agent': `Alexandria/1.0 (mailto:${MAILTO})`,
}
const TIMEOUT_MS = 8000
const DELAY_MS   = 200  // polite pool — stay under rate limits

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export interface CrossRefResult {
  is_final:    boolean  // has volume OR first_page → attached to a final journal issue
  volume:      string | null
  issue:       string | null
  first_page:  string | null
}

async function fetchCrossRef(doi: string): Promise<any | null> {
  const url = `${CROSSREF_BASE}/${encodeURIComponent(doi)}?mailto=${MAILTO}`
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 404) return null  // DOI not in CrossRef (preprint, etc.)
    if (!res.ok) {
      console.error(`[crossref] HTTP ${res.status} for DOI ${doi}`)
      return null
    }
    return await res.json()
  } catch (err: any) {
    console.error(`[crossref] Network error for DOI ${doi}:`, err.message)
    return null
  }
}

function parseFinalization(data: any): CrossRefResult {
  const work = data?.message ?? {}
  const volume     = work.volume     ?? null
  const issue      = work.issue      ?? null
  const first_page = work.page       ? work.page.split('-')[0] : null
  // published-print presence is the strongest signal (typeset, paginated)
  const hasPrint   = !!(work['published-print'] ?? work['published'])
  const is_final   = hasPrint && !!(volume || first_page)
  return { is_final, volume, issue, first_page }
}

// Check finalization for a list of DOIs via CrossRef (sequential, polite).
// Returns map of doi → CrossRefResult.
// DOIs not found in CrossRef are omitted from the map.
export async function checkFinalizationByDois(dois: string[]): Promise<Map<string, CrossRefResult>> {
  const result = new Map<string, CrossRefResult>()
  if (dois.length === 0) return result

  console.log(`[crossref] Checking finalization for ${dois.length} DOIs`)

  for (let i = 0; i < dois.length; i++) {
    const doi = dois[i]
    const data = await fetchCrossRef(doi)
    if (data) {
      result.set(doi, parseFinalization(data))
    }
    if (i < dois.length - 1) await sleep(DELAY_MS)
  }

  const finals = Array.from(result.values()).filter(r => r.is_final).length
  console.log(`[crossref] Done — ${result.size}/${dois.length} found, ${finals} finalized`)
  return result
}
