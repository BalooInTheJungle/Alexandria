"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type UploadResult = {
  filename: string;
  documentId: string;
  status: string;
  chunksCount: number;
  error?: string;
  skipped?: boolean;
};

export default function DatabasePage() {
  const [docCount, setDocCount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/documents/count");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.count === "number") setDocCount(data.count);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [uploadResults]);

  const onUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadResults(null);
    const form = new FormData();
    for (let i = 0; i < Math.min(files.length, 10); i++) {
      form.append("file", files[i]);
    }
    try {
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      const data = await res.json();
      if (data.results) setUploadResults(data.results);
      else if (data.error) setUploadResults([{ filename: "", documentId: "", status: "error", chunksCount: 0, error: data.error }]);
    } catch (e) {
      setUploadResults([{ filename: "", documentId: "", status: "error", chunksCount: 0, error: String(e) }]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 space-y-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Database</h1>
        <p className="mt-2 text-muted-foreground">
          Gestion des documents indexés : consulter le nombre de documents en base et ajouter des PDF à la main pour les faire ingérer dans le corpus (RAG et similarité).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents en base</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-semibold tabular-nums">
            {docCount === null ? "—" : docCount} document{docCount !== 1 ? "s" : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ces documents sont utilisés pour la recherche RAG et le score de similarité de la veille.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajouter des documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onUploadFiles(e.dataTransfer.files);
            }}
          >
            <p className="text-sm text-muted-foreground mb-2">
              Glissez-déposez des PDF ici ou cliquez pour choisir (max 10, 20 Mo chacun).
            </p>
            <Input
              type="file"
              accept="application/pdf"
              multiple
              className="max-w-xs mx-auto cursor-pointer"
              disabled={uploading}
              onChange={(e) => onUploadFiles(e.target.files)}
            />
          </div>
          {uploading && <p className="text-sm text-muted-foreground">Ingestion en cours…</p>}
          {uploadResults && uploadResults.length > 0 && (
            <div className="rounded border p-4 space-y-2">
              <p className="text-sm font-medium">Résultat</p>
              <ul className="text-sm space-y-1">
                {uploadResults.map((r, i) => (
                  <li key={i}>
                    {r.filename} → {r.status}
                    {r.skipped && " — Déjà en base (DOI identique)"}
                    {r.chunksCount > 0 ? ` (${r.chunksCount} chunks)` : ""}
                    {r.error && ` — ${r.error}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
