// Generates a structured JSON summary of top-scored veille articles.
// GPT only produces 3 text fields per article (contribution, relevance, corpus_link).
// All factual data (authors, doi, score, corpus_refs) comes from DB — zero token waste.

import OpenAI from 'openai'
import type { CorpusRef } from '../db/types'

const SCORE_THRESHOLD    = 0.75
const MAX_ARTICLES       = 8
const MAX_ABSTRACT_CHARS = 300
const MAX_EXCERPT_CHARS  = 150

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120_000 })
}

interface ArticleInput {
  id:               string
  title:            string
  abstract:         string | null
  source_name:      string | null
  similarity_score: number | null
  corpus_refs:      CorpusRef[]
}

function buildPrompt(articles: ArticleInput[]): string {
  const articleBlocks = articles.map((a, i) => {
    const refs = a.corpus_refs.length > 0
      ? a.corpus_refs
          .map(r =>
            `  • [${r.doc_title}${r.page != null ? `, p.${r.page}` : ''}, ${Math.round(r.similarity * 100)}%]\n    "${r.excerpt.slice(0, MAX_EXCERPT_CHARS)}"`
          )
          .join('\n')
      : '  (aucune référence corpus ≥ 75%)'

    return `--- Article ${i + 1} ---
ID     : ${a.id}
Titre  : ${a.title}
Source : ${a.source_name ?? 'inconnue'}
Score  : ${Math.round((a.similarity_score ?? 0) * 100)}%
Résumé : ${a.abstract ? a.abstract.slice(0, MAX_ABSTRACT_CHARS) : '(pas de résumé)'}
Passages du corpus ayant déclenché le score :
${refs}`
  }).join('\n\n')

  return `Tu es un assistant de veille scientifique pour un chercheur CNRS spécialisé en matériaux moléculaires et magnétisme (complexes à transition de spin, aimants moléculaires, matériaux bistables, propriétés magnéto-optiques).

Voici ${articles.length} articles récents sélectionnés car ils sont proches du corpus bibliographique du chercheur.
Pour chaque article, les passages exacts du corpus qui ont déclenché le score de similarité sont fournis.

${articleBlocks}

Ta tâche : produire un JSON valide avec cette structure exacte (aucun texte hors du JSON) :

{
  "themes": [
    {
      "title": "Nom court du thème",
      "description": "2-3 phrases sur ce thème et sa signification pour ce chercheur cette semaine."
    }
  ],
  "articles": [
    {
      "item_id": "<ID exact de l'article tel que fourni ci-dessus>",
      "contribution": "Ce que l'article apporte scientifiquement : résultats clés, méthode, nouveauté. 2-3 phrases.",
      "relevance": "Pourquoi cet article est utile pour le chercheur : lien avec ses thématiques, potentiel de citation, application concrète. 2-3 phrases.",
      "corpus_link": "Explication précise du lien avec le corpus : même technique, même famille de matériaux, résultats complémentaires ou contradictoires. Cite les titres et pages des documents corpus entre crochets. 2-3 phrases."
    }
  ]
}

Contraintes :
- Identifie 2 à 3 thèmes émergents.
- Inclus un objet pour chacun des ${articles.length} articles dans "articles", avec l'item_id exact.
- Réponds uniquement en français.
- Ne produis aucun texte hors du JSON.`
}

// ── Public types (used by the front to render the summary) ────────────────────

export type SummaryTheme = {
  title:       string
  description: string
}

export type SummaryArticle = {
  item_id:      string
  contribution: string
  relevance:    string
  corpus_link:  string
}

export type StructuredSummary = {
  themes:   SummaryTheme[]
  articles: SummaryArticle[]
}

export function parseSummary(raw: string): StructuredSummary | null {
  try {
    const p = JSON.parse(raw)
    if (p && Array.isArray(p.themes) && Array.isArray(p.articles)) {
      return p as StructuredSummary
    }
    return null
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateVeilleSummary(
  items: ArticleInput[],
  threshold = SCORE_THRESHOLD
): Promise<{ summary: string; highScoreCount: number }> {
  const eligible = items
    .filter(i => (i.similarity_score ?? 0) >= threshold && i.title)
    .sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0))

  const highScoreCount = eligible.length
  const toProcess      = eligible.slice(0, MAX_ARTICLES)

  console.log(`[summarize] ${highScoreCount} articles >= ${threshold}, processing top ${toProcess.length}`)

  if (toProcess.length === 0) {
    return {
      summary:        JSON.stringify({ themes: [], articles: [] }),
      highScoreCount: 0,
    }
  }

  const openai = getOpenAI()
  const prompt = buildPrompt(toProcess)

  console.log(`[summarize] Calling GPT — ${toProcess.length} articles, corpus_refs pre-computed`)

  const response = await openai.chat.completions.create({
    model:           'gpt-4o-mini',
    max_tokens:      8000,
    temperature:     0.3,
    response_format: { type: 'json_object' },
    messages:        [{ role: 'user', content: prompt }],
  })

  const summary = response.choices[0]?.message?.content
    ?? JSON.stringify({ themes: [], articles: [] })

  console.log(`[summarize] Done — ${summary.length} chars`)
  return { summary, highScoreCount }
}
