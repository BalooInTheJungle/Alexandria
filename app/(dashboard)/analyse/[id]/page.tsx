"use client"

import React, { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import AnalysisChatPanel from "@/components/analyse/AnalysisChatPanel"

type Summary = {
  tldr: string; intro: string; methods: string; results: string; discussion: string
}
type CorpusRef = {
  doc_title: string | null; excerpt: string; page: number | null; similarity: number
}
type CitedRef = {
  doi: string; in_corpus: boolean; title: string | null; year: number | null; authors: string[]
}
type SsRec = {
  title: string; authors: string[]; year: number | null; doi: string | null; abstract: string | null
}
type Analysis = {
  id: string; title: string | null; doi: string | null; status: string
  summary: Summary | null; corpus_refs: CorpusRef[] | null
  cited_refs: CitedRef[] | null; ss_recs: SsRec[] | null
  is_integrated: boolean; document_id: string | null
}

const TABS = [
  { id: "corpus",     label: "1 · Proximité corpus" },
  { id: "summary",    label: "2 · Résumé" },
  { id: "chat",       label: "3 · Discussion" },
  { id: "recommend",  label: "4 · Aller plus loin" },
] as const
type TabId = typeof TABS[number]["id"]

const SECTION_LABELS = {
  intro: "Problème & contexte",
  methods: "Méthodes",
  results: "Résultats",
  discussion: "Discussion & limites",
}

function ScoreRing({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 75 ? "text-green-600" : pct >= 50 ? "text-primary" : "text-muted-foreground"
  return (
    <div className={`flex flex-col items-center justify-center w-24 h-24 rounded-full border-4 ${pct >= 75 ? "border-green-500" : pct >= 50 ? "border-primary" : "border-border"}`}>
      <span className={`text-2xl font-bold ${color}`}>{pct}%</span>
      <span className="text-xs text-muted-foreground">similarité</span>
    </div>
  )
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [integrating, setIntegrating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>("corpus")

  useEffect(() => {
    let cancelled = false
    fetch(`/api/analyse/${id}/insights`)
      .then((r) => r.ok ? r.json() : r.json().then((d) => { throw new Error(d.error ?? "Erreur") }))
      .then((data: Analysis) => { if (!cancelled) { setAnalysis(data); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [id])

  async function handleIntegrate() {
    if (!analysis) return
    setIntegrating(true)
    try {
      const res = await fetch(`/api/analyse/${id}/integrate`, { method: "POST" })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      setAnalysis((a) => a ? { ...a, is_integrated: true } : a)
    } catch (err) { alert(err instanceof Error ? err.message : "Erreur") }
    finally { setIntegrating(false) }
  }

  if (loading) return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center space-y-3">
      <div className="text-4xl animate-pulse">⚙️</div>
      <p className="text-sm font-medium">Analyse en cours…</p>
      <p className="text-xs text-muted-foreground">Résumé · Connexions corpus · Références · Recommandations SS<br />15 à 40 secondes</p>
    </main>
  )

  if (error) return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center space-y-4">
      <p className="text-destructive font-medium">{error}</p>
      <Button variant="outline" onClick={() => router.push("/analyse")}>← Retour</Button>
    </main>
  )

  if (!analysis) return null

  const summary = analysis.summary
  const corpusRefs = analysis.corpus_refs ?? []
  const citedRefs = analysis.cited_refs ?? []
  const ssRecs = analysis.ss_recs ?? []
  const inCorpusCount = citedRefs.filter((r) => r.in_corpus).length
  const topScore = corpusRefs.length > 0 ? Math.max(...corpusRefs.map((r) => r.similarity)) : 0

  return (
    <main className="w-full px-6 py-4 space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <button onClick={() => router.push("/analyse")} className="text-xs text-muted-foreground hover:text-foreground">
            ← Retour
          </button>
          <h1 className="text-xl font-bold font-title leading-snug">{analysis.title ?? "Document analysé"}</h1>
          {analysis.doi && <p className="text-xs text-muted-foreground font-mono">{analysis.doi}</p>}
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

      {/* Onglets */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Onglet 1 : Proximité corpus ── */}
      {tab === "corpus" && (
        <div className="space-y-6">
          {corpusRefs.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Aucune connexion trouvée dans le corpus.</CardContent></Card>
          ) : (
            <>
              {/* Score global */}
              <div className="flex items-center gap-6 p-5 rounded-lg border border-border bg-card">
                <ScoreRing score={topScore} />
                <div className="space-y-1">
                  <p className="font-semibold">
                    {topScore >= 0.75 ? "Très proche de votre corpus" : topScore >= 0.5 ? "Connexions significatives" : "Connexions faibles"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {corpusRefs.length} passage{corpusRefs.length > 1 ? "s" : ""} du corpus correspondent à ce document.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Score de similarité cosinus — basé sur l&apos;embedding moyen du document vs votre corpus.
                  </p>
                </div>
              </div>

              {/* Passages proches */}
              <div className="space-y-3">
                {corpusRefs.map((ref, i) => (
                  <Card key={i}>
                    <CardContent className="py-4 px-5">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-sm font-medium leading-snug">{ref.doc_title ?? "Document corpus"}</p>
                        <span className="shrink-0 text-sm font-bold text-primary">{Math.round(ref.similarity * 100)}%</span>
                      </div>
                      {ref.page && <p className="text-xs text-muted-foreground mb-1">Page {ref.page}</p>}
                      <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/20 pl-3">
                        {ref.excerpt}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Onglet 2 : Résumé ── */}
      {tab === "summary" && (
        <div className="space-y-4">
          {!summary ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Résumé non disponible.</CardContent></Card>
          ) : (
            <>
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-5 py-4">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">En bref</p>
                <p className="text-sm leading-relaxed">{summary.tldr}</p>
              </div>
              {(["intro", "methods", "results", "discussion"] as const).map((key) =>
                summary[key] ? (
                  <Card key={key}>
                    <CardContent className="py-4 px-5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        {SECTION_LABELS[key]}
                      </p>
                      <p className="text-sm leading-relaxed">{summary[key]}</p>
                    </CardContent>
                  </Card>
                ) : null
              )}
            </>
          )}
        </div>
      )}

      {/* ── Onglet 3 : Discussion ── */}
      {tab === "chat" && (
        <div className="h-[calc(100vh-190px)] flex flex-col gap-3">
          <p className="text-sm text-muted-foreground shrink-0">
            Interrogez ce document et votre corpus. Les réponses citent les passages sources.
          </p>
          <div className="flex-1 min-h-0">
            <AnalysisChatPanel analysisId={id} title={analysis.title ?? undefined} />
          </div>
        </div>
      )}

      {/* ── Onglet 4 : Aller plus loin ── */}
      {tab === "recommend" && (
        <div className="space-y-6">

          {/* Références citées */}
          {citedRefs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Références citées dans le document</h3>
                <span className="text-xs text-muted-foreground">{inCorpusCount}/{citedRefs.length} dans votre corpus</span>
              </div>
              {citedRefs.map((ref, i) => (
                <Card key={i}>
                  <CardContent className="py-3 px-5 flex items-start gap-3">
                    <span className={[
                      "shrink-0 mt-0.5 text-xs font-bold px-1.5 py-0.5 rounded",
                      ref.in_corpus ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground",
                    ].join(" ")}>
                      {ref.in_corpus ? "✓ corpus" : "—"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium line-clamp-1">{ref.title ?? ref.doi}</p>
                      <p className="text-xs text-muted-foreground">
                        {ref.authors.slice(0, 3).join(", ")}{ref.authors.length > 3 ? " et al." : ""}
                        {ref.year ? ` · ${ref.year}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{ref.doi}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Recommandations SS */}
          {ssRecs.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Articles similaires — Semantic Scholar</h3>
              {ssRecs.map((rec, i) => (
                <Card key={i}>
                  <CardContent className="py-4 px-5 space-y-1">
                    <p className="text-sm font-medium leading-snug">{rec.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {rec.authors.slice(0, 3).join(", ")}{rec.authors.length > 3 ? " et al." : ""}
                      {rec.year ? ` · ${rec.year}` : ""}
                    </p>
                    {rec.abstract && <p className="text-xs text-muted-foreground line-clamp-2">{rec.abstract}</p>}
                    {rec.doi && (
                      <a href={`https://doi.org/${rec.doi}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary underline underline-offset-2">
                        {rec.doi}
                      </a>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {citedRefs.length === 0 && ssRecs.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Aucune recommandation disponible.</CardContent></Card>
          )}
        </div>
      )}

    </main>
  )
}
