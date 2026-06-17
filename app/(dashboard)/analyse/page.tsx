"use client"

import React, { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type VeilleItem = {
  id: string
  title: string
  authors: string | null
  published_at: string | null
  similarity_score: number
  doi: string | null
  url: string | null
  ai_analysis: { contribution: string; relevance: string; corpus_link: string } | null
}

export default function AnalysePage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [articles, setArticles] = useState<VeilleItem[]>([])
  const [loadingArticles, setLoadingArticles] = useState(true)
  const [activeUploadFor, setActiveUploadFor] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/veille/items/top?page=1")
      .then((r) => r.json())
      .then((d) => setArticles(d.items ?? []))
      .catch(() => setArticles([]))
      .finally(() => setLoadingArticles(false))
  }, [])

  const uploadFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      setUploadError("Le fichier doit être un PDF.")
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/analyse/upload", { method: "POST", body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Upload échoué")
      router.push(`/analyse/${data.analysisId}`)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Erreur inattendue")
      setUploading(false)
    }
  }, [router])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>, articleId?: string) => {
    const file = e.target.files?.[0]
    if (file) {
      setActiveUploadFor(articleId ?? null)
      uploadFile(file)
    }
    e.target.value = ""
  }, [uploadFile])

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-title">Analyse de document</h1>
        <p className="text-muted-foreground mt-1">
          Uploadez un PDF pour l&apos;analyser, le connecter à votre corpus et recevoir des recommandations Semantic Scholar.
        </p>
      </div>

      {/* Zone d'upload libre */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Analyser un PDF</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={[
              "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors select-none",
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
              uploading ? "opacity-60 cursor-wait" : "",
            ].join(" ")}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => onFileChange(e)}
            />
            {uploading ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">Extraction et vectorisation en cours…</div>
                <div className="text-xs text-muted-foreground">Cela peut prendre 15 à 30 secondes selon la taille du PDF.</div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-3xl">📄</div>
                <div className="text-sm font-medium">Glissez un PDF ici ou cliquez pour choisir un fichier</div>
                <div className="text-xs text-muted-foreground">Maximum 20 Mo</div>
              </div>
            )}
          </div>
          {uploadError && (
            <p className="mt-2 text-sm text-destructive">{uploadError}</p>
          )}
        </CardContent>
      </Card>

      {/* Articles veille ≥80% du dernier run */}
      <div>
        <h2 className="text-lg font-semibold font-title mb-3">
          Articles pertinents à analyser
          <span className="ml-2 text-sm font-normal text-muted-foreground">score ≥ 80%</span>
        </h2>

        {loadingArticles ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Chargement…</div>
        ) : articles.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            Aucun article ≥ 80% pour le moment. Relancez la veille ou attendez le prochain run automatique.
          </div>
        ) : (
          <div className="space-y-3">
            {articles.map((item) => (
              <Card key={item.id}>
                <CardContent className="py-4 px-5 flex items-start gap-4">
                  {/* Score badge */}
                  <div className="shrink-0 mt-0.5">
                    <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold px-2.5 py-1 min-w-[3.5rem]">
                      {Math.round(item.similarity_score * 100)}%
                    </span>
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="font-medium text-sm leading-snug line-clamp-2">
                      {item.title || "Sans titre"}
                    </div>
                    {item.authors && (
                      <div className="text-xs text-muted-foreground truncate">{item.authors}</div>
                    )}
                    {item.ai_analysis?.relevance && (
                      <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {item.ai_analysis.relevance}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline underline-offset-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Voir l&apos;article →
                        </a>
                      )}
                      {item.doi && (
                        <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                          {item.doi}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bouton analyser */}
                  <div className="shrink-0">
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      id={`upload-${item.id}`}
                      onChange={(e) => onFileChange(e, item.id)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => document.getElementById(`upload-${item.id}`)?.click()}
                    >
                      {uploading && activeUploadFor === item.id ? "Chargement…" : "Analyser le PDF"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
