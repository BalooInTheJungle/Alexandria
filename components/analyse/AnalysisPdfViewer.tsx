"use client"

import React, { useEffect, useState, useCallback, useRef } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/esm/Page/TextLayer.css"
import "react-pdf/dist/esm/Page/AnnotationLayer.css"

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`

type Props = {
  analysisId: string
  page: number | null
  highlight: string | null
}

function normalise(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

export default function AnalysisPdfViewer({ analysisId, page, highlight }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    fetch(`/api/analyse/${analysisId}/pdf`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setPdfUrl(d.url); else setError("PDF non disponible pour cette analyse.") })
      .catch(() => setError("Erreur de chargement du PDF"))
  }, [analysisId])

  useEffect(() => {
    if (!page || page < 1) return
    const el = pageRefs.current[page - 1]
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [page, highlight])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(Math.floor(entries[0].contentRect.width))
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const [containerWidth, setContainerWidth] = useState<number>(700)

  const makeTextRenderer = useCallback((targetPage: number) => {
    return ({ str }: { str: string }) => {
      if (!highlight || !str || str.length < 3) return str
      const normStr = normalise(str)
      const normHL = normalise(highlight)
      const fragment = normHL.slice(0, 40)
      if (normStr.includes(fragment.slice(0, 20))) {
        return `<mark style="background:rgba(234,179,8,0.45);border-radius:2px;padding:0 1px;">${str}</mark>`
      }
      if (normHL.includes(normStr) && normStr.length > 10) {
        return `<mark style="background:rgba(234,179,8,0.45);border-radius:2px;padding:0 1px;">${str}</mark>`
      }
      return str
    }
  }, [highlight])

  if (error) return (
    <div className="text-xs text-muted-foreground py-6 text-center rounded border border-border bg-muted/20">
      {error}
    </div>
  )

  if (!pdfUrl) return (
    <div className="text-xs text-muted-foreground py-6 text-center animate-pulse">Chargement du PDF…</div>
  )

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col">
      {numPages > 0 && (
        <p className="text-[10px] text-muted-foreground mb-1 shrink-0">
          {numPages} page{numPages > 1 ? "s" : ""}
          {page ? ` · affichage page ${page}` : ""}
        </p>
      )}
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0 rounded border border-border">
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n)
            pageRefs.current = new Array(n).fill(null)
          }}
          onLoadError={() => setError("Impossible de lire le PDF")}
          loading={<div className="text-xs text-muted-foreground py-8 text-center animate-pulse">Chargement…</div>}
        >
          <div className="flex flex-row gap-2 p-2 w-max">
            {Array.from({ length: numPages }, (_, i) => {
              const pageNum = i + 1
              const isTarget = pageNum === page
              return (
                <div
                  key={pageNum}
                  ref={(el) => { pageRefs.current[i] = el }}
                  className={[
                    "rounded shrink-0 border border-border",
                    isTarget ? "ring-2 ring-primary/50" : "",
                  ].join(" ")}
                >
                  <Page
                    pageNumber={pageNum}
                    height={480}
                    renderTextLayer={true}
                    renderAnnotationLayer={false}
                    customTextRenderer={isTarget ? makeTextRenderer(pageNum) : undefined}
                    loading={<div style={{ width: 300, height: 400 }} className="animate-pulse bg-muted/10" />}
                  />
                </div>
              )
            })}
          </div>
        </Document>
      </div>
    </div>
  )
}
