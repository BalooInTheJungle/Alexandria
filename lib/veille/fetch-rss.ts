// Fetches RSS feeds from journal sources and extracts articles
// Returns: title, doi, url, published_at, abstract (when available in the feed)

import Parser from 'rss-parser'

const USER_AGENT = 'Alexandria/1.0 (mailto:carel.clogenson@epitech.digital)'

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': USER_AGENT },
  customFields: {
    item: [
      ['dc:identifier',         'dcIdentifier'],
      ['prism:doi',             'prismDoi'],
      ['dc:description',        'dcDescription'],
      ['content:encoded',       'contentEncoded'],
      ['prism:publicationDate', 'prismDate'],
      ['dc:creator',            'dcCreator'],
      ['prism:author',          'prismAuthor'],
    ],
  },
})

const DOI_REGEX = /10\.\d{4,9}\/[^\s"<>\]\[]+/

export interface RssArticle {
  title:        string
  url:          string
  doi:          string | null
  published_at: string | null
  abstract:     string | null
  authors:      string[]
}

export interface RssSource {
  id:        string
  name:      string
  publisher: string
  issn:      string
  rss_url:   string
}

// Extract DOI — handles doi:10.xxx prefix (Elsevier), https://doi.org/..., and bare DOIs
function extractDoi(item: Record<string, any>): string | null {
  const candidates = [
    item.dcIdentifier,
    item.prismDoi,
    item.guid,
    item.link,
    item.contentSnippet,
  ]
  for (const c of candidates) {
    if (!c) continue
    const str = String(c)
    // Strip common prefixes before matching
    const normalized = str.replace(/^(doi:|DOI:|https?:\/\/doi\.org\/)/i, '')
    const match = normalized.match(DOI_REGEX)
    if (match) return match[0].replace(/[.,;)]+$/, '')
  }
  return null
}

// Extract authors from dc:creator (semicolon-separated) or rss-parser's built-in author field
function extractAuthors(item: Record<string, any>): string[] {
  const raw: string | undefined = item.dcCreator ?? item.prismAuthor ?? item.author
  if (!raw) return []
  // dc:creator can be "Last, First; Last2, First2" or "First Last, First2 Last2"
  return raw.split(/;|,\s+(?=[A-Z])/).map((s: string) => s.trim()).filter(Boolean)
}

// Titles that identify non-research content to skip entirely
const EDITORIAL_TITLE_PREFIXES = /^(correction|erratum|corrigendum|retraction|publisher correction|addendum|withdrawal|editor.s note)[\s:]/i

// Extract abstract — strip HTML tags, clean publisher noise, cap at 2000 chars
function extractAbstract(item: Record<string, any>): string | null {
  const raw = item.contentEncoded || item.content || item.dcDescription || item.contentSnippet || null
  if (!raw) return null
  let clean = String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length < 80) return null

  // Reject Nature DOI stubs: "Journal, Published online: ...; doi:10..."
  if (/^[\w\s,]+published online[^.]+doi:/i.test(clean)) return null
  // Reject RSC licence boilerplate (corrections and open-access notices)
  if (/this article is licensed under a creative commons/i.test(clean)) return null
  // Reject Elsevier metadata format (no abstract in feed): "Publication date: ... Source: ... Author(s): ..."
  if (/^publication date:/i.test(clean)) return null

  // Reject RSC metadata prefix: "Journal Name, Year, Vol, Pages DOI : ..." → let OpenAlex fetch the real abstract
  if (/^\w[\w\s.]*,\s*\d{4},\s*\d+/.test(clean)) return null
  // Strip RSC RSS footer from the end of otherwise valid abstracts
  clean = clean.replace(/The content of this RSS Feed \(c\) The Royal Society of Chemistry\.?/gi, '').trim()

  return clean.length >= 80 ? clean.slice(0, 2000) : null
}

// Fetch and parse one RSS feed
export async function fetchRssFeed(source: RssSource): Promise<RssArticle[]> {
  console.log(`[fetchRssFeed] Fetching ${source.name} (${source.publisher})`)

  let feed
  try {
    feed = await parser.parseURL(source.rss_url)
  } catch (err: any) {
    console.error(`[fetchRssFeed] Error fetching ${source.name}:`, err.message)
    return []
  }

  const articles: RssArticle[] = []

  for (const item of feed.items ?? []) {
    const title = item.title?.trim()
    if (!title) continue

    // Skip corrections, errata, retractions — not original research
    if (EDITORIAL_TITLE_PREFIXES.test(title)) continue

    articles.push({
      title,
      url:          item.link ?? '',
      doi:          extractDoi(item as Record<string, any>),
      published_at: item.pubDate ?? item.isoDate ?? (item as any).prismDate ?? null,
      abstract:     extractAbstract(item as Record<string, any>),
      authors:      extractAuthors(item as Record<string, any>),
    })
  }

  const withAuthors = articles.filter(a => a.authors.length > 0).length
  console.log(`[fetchRssFeed] ${source.name}: ${articles.length} articles, ${articles.filter(a => a.doi).length} with DOI, ${articles.filter(a => a.abstract).length} with abstract, ${withAuthors} with authors`)
  return articles
}

// Fetch all RSS sources sequentially (300ms delay to be polite)
export async function fetchAllRssFeeds(sources: RssSource[]): Promise<Map<string, RssArticle[]>> {
  console.log(`[fetchAllRssFeeds] Starting — ${sources.length} sources`)
  const results = new Map<string, RssArticle[]>()

  for (const source of sources) {
    results.set(source.id, await fetchRssFeed(source))
    await new Promise(r => setTimeout(r, 300))
  }

  const total = Array.from(results.values()).reduce((sum, arr) => sum + arr.length, 0)
  console.log(`[fetchAllRssFeeds] Done — ${total} articles from ${sources.length} sources`)
  return results
}
