// Generates a French AI summary of top-scored veille articles
// Option B: fetches matching corpus chunks for each article to contextualize relevance

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { embedQuery } from '../rag/embed'

const SCORE_THRESHOLD = 0.75
const MAX_ARTICLES    = 15  // cap to stay within token budget
const CHUNKS_PER_ARTICLE = 2

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
}

interface ArticleToSummarize {
  id:       string
  title:    string
  abstract: string | null
  source:   string | null
  score:    number
}

interface ArticleWithContext extends ArticleToSummarize {
  corpusExcerpts: CorpusChunk[]
}

interface CorpusChunk { doc_title: string | null; content: string }

async function fetchCorpusChunks(abstract: string, matchCount: number): Promise<CorpusChunk[]> {
  try {
    const embedding = await embedQuery(abstract)
    const supabase  = getSupabase()
    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding:  embedding,
      match_threshold:  0.0,
      match_count:      matchCount,
    })
    if (error || !data) return []
    return (data as { doc_title: string | null; content: string }[]).map(c => ({
      doc_title: c.doc_title,
      content:   c.content.slice(0, 350),
    }))
  } catch (err: any) {
    console.error('[summarize] fetchCorpusChunks error:', err.message)
    return []
  }
}

function buildPrompt(articles: ArticleWithContext[]): string {
  const articleBlocks = articles.map((a, i) => {
    const excerpts = a.corpusExcerpts.length > 0
      ? `Extraits du corpus correspondants :\n${a.corpusExcerpts.map(e => `• [${e.doc_title ?? 'sans titre'}] ${e.content}`).join('\n')}`
      : `Aucun extrait du corpus trouvé.`
    return `--- Article ${i + 1} (score ${a.score.toFixed(2)}) ---
Titre : ${a.title}
Source : ${a.source ?? 'inconnue'}
Résumé : ${a.abstract ? a.abstract.slice(0, 600) : '(pas de résumé)'}
${excerpts}`
  }).join('\n\n')

  return `Tu es un assistant de veille scientifique pour un chercheur en matériaux moléculaires et magnétisme.

Voici ${articles.length} articles récents sélectionnés cette semaine car ils sont proches du corpus bibliographique du chercheur.
Pour chaque article, des extraits du corpus sont fournis pour montrer la proximité thématique.

${articleBlocks}

Ta tâche (en français) :
1. Identifie les 2-3 thèmes émergents de cette semaine en 1-2 phrases chacun.
2. Pour chaque article, écris une ligne d'action en citant le(s) titre(s) du corpus correspondant entre crochets, et indique une action concrète (lire, citer, approfondir un point précis).

Format de réponse :
## Thèmes de la semaine
[thèmes]

## Articles à traiter en priorité
**[Titre court de l'article]** — Proche de [titre du corpus]. Action : [action concrète].
...`
}

export async function generateVeilleSummary(
  items: { id: string; title: string; abstract: string | null; source_name: string | null; similarity_score: number | null }[],
  threshold = SCORE_THRESHOLD
): Promise<{ summary: string; highScoreCount: number }> {
  const eligible = items
    .filter(i => (i.similarity_score ?? 0) >= threshold && i.title)
    .sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0))

  const highScoreCount = eligible.length
  const toProcess      = eligible.slice(0, MAX_ARTICLES)

  console.log(`[summarize] ${highScoreCount} articles >= ${threshold}, processing top ${toProcess.length}`)

  if (toProcess.length === 0) {
    return { summary: 'Aucun article au-dessus du seuil de pertinence cette semaine.', highScoreCount: 0 }
  }

  // Fetch corpus chunks for each article in parallel (2 chunks each)
  const articlesWithContext: ArticleWithContext[] = await Promise.all(
    toProcess.map(async (item) => {
      const excerpts: CorpusChunk[] = item.abstract && item.abstract.length > 50
        ? await fetchCorpusChunks(item.abstract, CHUNKS_PER_ARTICLE)
        : []
      return {
        id:             item.id,
        title:          item.title,
        abstract:       item.abstract,
        source:         item.source_name,
        score:          item.similarity_score ?? 0,
        corpusExcerpts: excerpts,
      }
    })
  )

  console.log(`[summarize] Corpus chunks fetched, calling GPT`)

  const openai = getOpenAI()
  const prompt = buildPrompt(articlesWithContext)

  const response = await openai.chat.completions.create({
    model:       'gpt-4o-mini',
    max_tokens:  1200,
    temperature: 0.4,
    messages: [
      { role: 'user', content: prompt },
    ],
  })

  const summary = response.choices[0]?.message?.content ?? 'Résumé indisponible.'
  console.log(`[summarize] Summary generated (${summary.length} chars)`)

  return { summary, highScoreCount }
}
