"use client"

import React, { useEffect, useState, useCallback } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`

type Props = {
  analysisId: string
  page: number | null
  highlight: string | null
}

export default function AnalysisPdfViewer({ analysisId, page, highlight }: Props) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [error, setError] = useState<string | null>(null)
  const [containerWidth, setContainerWidth] = useState<number>(400)
  const containerRef = React.useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/analyse/${analysisId}/pdf`)
      .then((r) => r.json())
      .then((d) => { if (d.url) setPdfUrl(d.url); else setError("PDF non disponible") })
      .catch(() => setError("Erreur de chargement du PDF"))
  }, [analysisId])

  useEffect(() => {
    if (page && page > 0) setCurrentPage(page)
  }, [page])

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width)
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  const customTextRenderer = useCallback(({ str }: { str: string }) => {
    if (!highlight || !str) return str
    const idx = str.toLowerCase().indexOf(highlight.slice(0, 30).toLowerCase())
    if (idx === -1) return str
    return (
      `<mark style="background:rgba(234,179,8,0.4);border-radius:2px;">${str}</mark>`
    )
  }, [highlight])

  if (error) return (
    <div className="text-xs text-muted-foreground py-3 text-center">{error}</div>
  )

  if (!pdfUrl) return (
    <div className="text-xs text-muted-foreground py-3 text-center animate-pulse">Chargement du PDF…</div>
  )

  return (
    <div ref={containerRef} className="w-full">
      {/* Navigation pages */}
      <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          className="px-2 py-0.5 rounded border border-border hover:border-primary disabled:opacity-30"
        >←</button>
        <span>Page {currentPage} / {numPages || "…"}</span>
        <button
          onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
          disabled={currentPage >= numPages}
          className="px-2 py-0.5 rounded border border-border hover:border-primary disabled:opacity-30"
        >→</button>
      </div>

      <div className="overflow-hidden rounded border border-border">
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={() => setError("Impossible de lire le PDF")}
          loading={<div className="text-xs text-muted-foreground py-6 text-center animate-pulse">Chargement…</div>}
        >
          <Page
            pageNumber={currentPage}
            width={containerWidth}
            renderTextLayer={true}
            renderAnnotationLayer={false}
            customTextRenderer={customTextRenderer}
          />
        </Document>
      </div>
    </div>
  )
}
