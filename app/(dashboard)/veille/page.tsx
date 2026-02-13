"use client";

const LOG = (msg: string, ...args: unknown[]) =>
  console.log("[veille/page]", msg, ...args);

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

type Source = {
  id: string;
  url: string;
  name: string | null;
  created_at?: string;
  last_checked_at?: string | null;
};

type VeilleRun = {
  id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  created_at?: string;
};

type VeilleItem = {
  id: string;
  run_id: string;
  source_id: string;
  url: string;
  title: string | null;
  authors: string[] | null;
  heuristic_score: number | null;
  similarity_score: number | null;
  source_name: string | null;
  document_id: string | null;
  created_at?: string;
};

type UploadResult = {
  filename: string;
  documentId: string;
  status: string;
  chunksCount: number;
  error?: string;
};

export default function VeillePage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<VeilleRun[]>([]);
  const [items, setItems] = useState<VeilleItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [filterRunId, setFilterRunId] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);

  const fetchSources = useCallback(async () => {
    LOG("fetchSources");
    setLoadingSources(true);
    try {
      const res = await fetch("/api/veille/sources");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      LOG("fetchSources ok", data?.length ?? 0);
      setSources(Array.isArray(data) ? data : []);
    } catch (e) {
      LOG("fetchSources error", e);
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    LOG("fetchRuns");
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/veille/runs?limit=20");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      LOG("fetchRuns ok", data?.length ?? 0);
      setRuns(Array.isArray(data) ? data : []);
    } catch (e) {
      LOG("fetchRuns error", e);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    LOG("fetchItems", { filterRunId });
    setLoadingItems(true);
    try {
      const url = filterRunId
        ? `/api/veille/items?runId=${encodeURIComponent(filterRunId)}&limit=100`
        : "/api/veille/items?limit=100";
      const res = await fetch(url);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      LOG("fetchItems ok", data?.length ?? 0);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      LOG("fetchItems error", e);
    } finally {
      setLoadingItems(false);
    }
  }, [filterRunId]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const pollRunStatus = useCallback(
    async (id: string) => {
      LOG("pollRunStatus", id);
      const res = await fetch(`/api/veille/runs/${id}`);
      if (!res.ok) return;
      const run = await res.json();
      setRunStatus(run.status);
      LOG("pollRunStatus", id, run.status);
      if (run.status === "running" || run.status === "pending") {
        setTimeout(() => pollRunStatus(id), 2000);
      } else {
        setScraping(false);
        fetchRuns();
        fetchItems();
      }
    },
    [fetchRuns, fetchItems]
  );

  const startScrape = async () => {
    LOG("startScrape");
    setScraping(true);
    setRunStatus("pending");
    try {
      const res = await fetch("/api/veille/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wait: false }),
      });
      const data = await res.json();
      LOG("startScrape response", data);
      if (data.runId) {
        setRunId(data.runId);
        pollRunStatus(data.runId);
      } else {
        setScraping(false);
      }
    } catch (e) {
      LOG("startScrape error", e);
      setScraping(false);
    }
  };

  const openAddSource = () => {
    setEditingSource(null);
    setSourceUrl("");
    setSourceName("");
    setSourceDialogOpen(true);
    LOG("openAddSource");
  };
  const openEditSource = (s: Source) => {
    setEditingSource(s);
    setSourceUrl(s.url);
    setSourceName(s.name ?? "");
    setSourceDialogOpen(true);
    LOG("openEditSource", s.id);
  };
  const saveSource = async () => {
    if (!sourceUrl.trim()) return;
    LOG("saveSource", { url: sourceUrl.slice(0, 50), editing: !!editingSource });
    try {
      if (editingSource) {
        const res = await fetch(`/api/veille/sources/${editingSource.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: sourceUrl.trim(), name: sourceName.trim() || null }),
        });
        if (!res.ok) throw new Error(await res.text());
        LOG("saveSource PATCH ok");
      } else {
        const res = await fetch("/api/veille/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: sourceUrl.trim(), name: sourceName.trim() || null }),
        });
        if (!res.ok) throw new Error(await res.text());
        LOG("saveSource POST ok");
      }
      setSourceDialogOpen(false);
      fetchSources();
    } catch (e) {
      LOG("saveSource error", e);
    }
  };
  const deleteSource = async (id: string) => {
    LOG("deleteSource", id);
    if (!confirm("Supprimer cette source ?")) return;
    try {
      const res = await fetch(`/api/veille/sources/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      LOG("deleteSource ok");
      fetchSources();
    } catch (e) {
      LOG("deleteSource error", e);
    }
  };

  const scoreFinal = (item: VeilleItem) => {
    const h = item.heuristic_score ?? 0;
    const v = item.similarity_score ?? 0;
    return (h + v) / 2;
  };

  const onUploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    LOG("onUploadFiles", files.length);
    setUploading(true);
    setUploadResults(null);
    const form = new FormData();
    for (let i = 0; i < Math.min(files.length, 10); i++) {
      form.append("file", files[i]);
    }
    try {
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      LOG("upload response", data);
      if (data.results) setUploadResults(data.results);
      else if (data.error) setUploadResults([{ filename: "", documentId: "", status: "error", chunksCount: 0, error: data.error }]);
    } catch (e) {
      LOG("upload error", e);
      setUploadResults([{ filename: "", documentId: "", status: "error", chunksCount: 0, error: String(e) }]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container max-w-6xl space-y-8 py-8">
      <h1 className="text-2xl font-semibold">Veille</h1>

      {/* Sources */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sources</CardTitle>
          <Button onClick={openAddSource} size="sm">
            Ajouter une source
          </Button>
        </CardHeader>
        <CardContent>
          {loadingSources ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune source. Ajoutez une URL à scraper.</p>
          ) : (
            <ScrollArea className="h-48 rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Dernière vérif.</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sources.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name || "—"}</TableCell>
                      <TableCell className="max-w-xs truncate font-mono text-xs">{s.url}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {s.last_checked_at ? new Date(s.last_checked_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openEditSource(s)}>
                          Modifier
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteSource(s.id)}>
                          Supprimer
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Lancer pipeline */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline veille</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={startScrape} disabled={scraping || sources.length === 0}>
            {scraping ? "Lancement…" : "Lancer la pipeline"}
          </Button>
          {runStatus && (
            <p className="text-sm text-muted-foreground">
              Statut : <span className="font-medium">{runStatus}</span>
              {runId && ` (run ${runId.slice(0, 8)}…)`}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tableau résultats */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Résultats de la veille</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Run</Label>
            <select
              className="rounded border bg-background px-2 py-1 text-sm"
              value={filterRunId}
              onChange={(e) => setFilterRunId(e.target.value)}
            >
              <option value="">Toutes</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.status} — {r.created_at ? new Date(r.created_at).toLocaleString() : r.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={fetchItems}>
              Rafraîchir
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingItems ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun résultat. Lancez une pipeline.</p>
          ) : (
            <ScrollArea className="h-[400px] rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Titre</TableHead>
                    <TableHead>Auteurs</TableHead>
                    <TableHead className="text-right">Heur.</TableHead>
                    <TableHead className="text-right">Vect.</TableHead>
                    <TableHead className="text-right">Final</TableHead>
                    <TableHead>En DB</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.source_name || "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{item.title || "—"}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs">
                        {item.authors?.length ? item.authors.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {item.heuristic_score != null ? item.heuristic_score.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {item.similarity_score != null ? item.similarity_score.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {scoreFinal(item).toFixed(2)}
                      </TableCell>
                      <TableCell>{item.document_id ? "Oui" : "Non"}</TableCell>
                      <TableCell>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary text-xs underline"
                        >
                          Lien
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Upload PDF */}
      <Card>
        <CardHeader>
          <CardTitle>Déposer des PDF</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
              LOG("dragOver");
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              LOG("drop", e.dataTransfer.files.length);
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
              onChange={(e) => {
                LOG("file input change", e.target.files?.length);
                onUploadFiles(e.target.files);
              }}
            />
          </div>
          {uploading && <p className="text-sm text-muted-foreground">Ingestion en cours…</p>}
          {uploadResults && uploadResults.length > 0 && (
            <div className="rounded border p-4 space-y-2">
              <p className="text-sm font-medium">Résultat</p>
              <ul className="text-sm space-y-1">
                {uploadResults.map((r, i) => (
                  <li key={i}>
                    {r.filename} → {r.status} {r.chunksCount > 0 ? `(${r.chunksCount} chunks)` : ""}
                    {r.error && ` — ${r.error}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog source */}
      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSource ? "Modifier la source" : "Ajouter une source"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="source-url">URL</Label>
              <Input
                id="source-url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="source-name">Nom (optionnel)</Label>
              <Input
                id="source-name"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Label de la source"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourceDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={saveSource} disabled={!sourceUrl.trim()}>
              {editingSource ? "Enregistrer" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
