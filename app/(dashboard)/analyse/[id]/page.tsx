"use client"

import React, { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import AnalysisChatPanel from "@/components/analyse/AnalysisChatPanel"
import { Button } from "@/components/ui/button"

type Summary = {
  tldr: string
  intro: string
  methods: string
  results: string
  discussion: string
}

type CorpusRef = {
  doc_title: string | null
  excerpt: string
  page: number | null
  similarity: number
}

type CitedRef = {
  doi: string
  in_corpus: boolean
  title: string | null
  year: number | null
  authors: string[]
}

type SsRec = {
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  abstract: string | null
}

type Analysis = {
  id: string
  title: string | null
  doi: string | null
  status: string
  summary: Summary | null
  corpus_refs: CorpusRef[] | null
  cited_refs: CitedRef[] | null
  ss_recs: SsRec[] | null
  is_integrated: boolean
  document_id: string | null
}

const SECTION_LABELS: Record<keyof Summary, string> = {
  tldr: "En bref",
  intro: "Problème & contexte",
  methods: "Méthodes",
  results: "Résultats",
  discussion: "Discussion & limites",
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [integrating, setIntegrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState("Chargement de l'analyse…")

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        // Récupère l'analyse (peut être ready → déclenche les insights)
        setStep("Vectorisation terminée, calcul des insights…")
        const res = await fetch(`/api/analyse/${id}/insights`)
        if (!res.ok) {
          const d = await res.json()
          throw new Error(d.error ?? "Erreur lors du calcul des insights")
        }
        const data: Analysis = await res.json()
        if (!cancelled) {
          setAnalysis(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erreur inattendue")
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [id])

  async function handleIntegrate() {
    if (!analysis) return
    setIntegrating(true)
    try {
      const res = await fetch(`/api/analyse/${id}/integrate`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur lors de l'intégration")
      }
      setAnalysis((a) => a ? { ...a, is_integrated: true } : a)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur inattendue")
    } finally {
      setIntegrating(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
        <div className="text-4xl animate-pulse">⚙️</div>
        <p className="text-sm font-medium">{step}</p>
        <p className="text-xs text-muted-foreground">
          Résumé GPT + connexions corpus + références croisées + recommandations SS…<br />
          Cela prend généralement 15 à 40 secondes.
        </p>
      </main>
    )
  }

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
        <p className="text-destructive font-medium">{error}</p>
        <Button variant="outline" onClick={() => router.push("/analyse")}>
          ← Retour
        </Button>
      </main>
    )
  }

  if (!analysis) return null

  const summary = analysis.summary
  const corpusRefs = analysis.corpus_refs ?? []
  const citedRefs = analysis.cited_refs ?? []
  const ssRecs = analysis.ss_recs ?? []
  const inCorpusCount = citedRefs.filter((r) => r.in_corpus).length

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <button
            onClick={() => router.push("/analyse")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Retour
          </button>
          <h1 className="text-xl font-bold font-title leading-snug">
            {analysis.title ?? "Document analysé"}
          </h1>
          {analysis.doi && (
            <p className="text-xs text-muted-foreground font-mono">{analysis.doi}</p>
          )}
        </div>
        <Button
          size="sm"
          variant={analysis.is_integrated ? "outline" : "default"}
          disabled={analysis.is_integrated || integrating}
          onClick={handleIntegrate}
          className="shrink-0"
        >
          {analysis.is_integrated ? "✓ Intégré au corpus" : integrating ? "Intégration…" : "Intégrer au corpus"}
        </Button>
      </div>

      {/* Résumé structuré */}
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Résumé structuré</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* TL;DR en avant */}
            <div className="rounded-md bg-primary/5 border border-primary/20 px-4 py-3">
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">En bref</p>
              <p className="text-sm">{summary.tldr}</p>
            </div>
            {/* Autres sections */}
            {(["intro", "methods", "results", "discussion"] as const).map((key) => (
              summary[key] && (
                <div key={key}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    {SECTION_LABELS[key]}
                  </p>
                  <p className="text-sm leading-relaxed">{summary[key]}</p>
                </div>
              )
            ))}
          </CardContent>
        </Card>
      )}

      {/* Passages corpus proches */}
      {corpusRefs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Connexions avec votre corpus
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {corpusRefs.length} passage{corpusRefs.length > 1 ? "s" : ""}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {corpusRefs.map((ref, i) => (
              <div key={i} className="border-l-2 border-primary/30 pl-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium truncate">{ref.doc_title ?? "Document corpus"}</p>
                  <span className="shrink-0 text-xs text-primary font-bold">
                    {Math.round(ref.similarity * 100)}%
                  </span>
                </div>
                {ref.page && (
                  <p className="text-xs text-muted-foreground">Page {ref.page}</p>
                )}
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                  {ref.excerpt}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Références citées */}
      {citedRefs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Références citées
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {inCorpusCount}/{citedRefs.length} dans votre corpus
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {citedRefs.map((ref, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                  <span className={[
                    "shrink-0 mt-0.5 text-xs font-bold px-1.5 py-0.5 rounded",
                    ref.in_corpus
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : "bg-muted text-muted-foreground",
                  ].join(" ")}>
                    {ref.in_corpus ? "✓" : "—"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium line-clamp-1">
                      {ref.title ?? ref.doi}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ref.authors.slice(0, 3).join(", ")}{ref.authors.length > 3 ? " et al." : ""}
                      {ref.year ? ` · ${ref.year}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{ref.doi}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommandations Semantic Scholar */}
      {ssRecs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Articles similaires — Semantic Scholar
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                basés sur cet article
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ssRecs.map((rec, i) => (
              <div key={i} className="space-y-1 py-2 border-b border-border last:border-0">
                <p className="text-sm font-medium leading-snug">{rec.title}</p>
                <p className="text-xs text-muted-foreground">
                  {rec.authors.slice(0, 3).join(", ")}{rec.authors.length > 3 ? " et al." : ""}
                  {rec.year ? ` · ${rec.year}` : ""}
                </p>
                {rec.abstract && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{rec.abstract}</p>
                )}
                {rec.doi && (
                  <a
                    href={`https://doi.org/${rec.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    {rec.doi}
                  </a>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Aucun résultat */}
      {!summary && corpusRefs.length === 0 && citedRefs.length === 0 && ssRecs.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Aucun insight généré. Le PDF était peut-être trop court ou sans texte extractible.
          </CardContent>
        </Card>
      )}

      {/* Chatbot document */}
      <div>
        <h2 className="text-lg font-semibold font-title mb-3">Discussion sur le document</h2>
        <AnalysisChatPanel analysisId={id} />
      </div>
    </main>
  )
}
