"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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

type TabId = "pipeline" | "historique" | "sources";

type Source = {
  id: string;
  url: string;
  name: string | null;
  fetch_strategy?: string | null;
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
  items_count?: number;
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

const FETCH_STRATEGIES = ["auto", "fetch", "rss"] as const;

export default function BibliographiePage() {
  const [tab, setTab] = useState<TabId>("pipeline");
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<VeilleRun[]>([]);
  const [items, setItems] = useState<VeilleItem[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceFetchStrategy, setSourceFetchStrategy] = useState<string>("auto");

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const res = await fetch("/api/veille/sources");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSources(Array.isArray(data) ? data : []);
    } catch {
      setSources([]);
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/veille/runs?limit=20");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const res = await fetch("/api/veille/items?limit=100");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

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
      const res = await fetch(`/api/veille/runs/${id}`);
      if (!res.ok) return;
      const run = await res.json();
      setRunStatus(run.status);
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
    setScraping(true);
    setRunStatus("pending");
    try {
      const res = await fetch("/api/veille/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wait: false }),
      });
      const data = await res.json();
      if (data.runId) {
        setRunId(data.runId);
        pollRunStatus(data.runId);
      } else {
        setScraping(false);
      }
    } catch {
      setScraping(false);
    }
  };

  const openAddSource = () => {
    setEditingSource(null);
    setSourceUrl("");
    setSourceName("");
    setSourceFetchStrategy("auto");
    setSourceDialogOpen(true);
  };
  const openEditSource = (s: Source) => {
    setEditingSource(s);
    setSourceUrl(s.url);
    setSourceName(s.name ?? "");
    setSourceFetchStrategy(s.fetch_strategy ?? "auto");
    setSourceDialogOpen(true);
  };
  const saveSource = async () => {
    if (!sourceUrl.trim()) return;
    try {
      const body: { url: string; name?: string | null; fetch_strategy?: string } = {
        url: sourceUrl.trim(),
        name: sourceName.trim() || null,
      };
      if (FETCH_STRATEGIES.includes(sourceFetchStrategy as typeof FETCH_STRATEGIES[number])) {
        body.fetch_strategy = sourceFetchStrategy;
      }
      if (editingSource) {
        const res = await fetch(`/api/veille/sources/${editingSource.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch("/api/veille/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setSourceDialogOpen(false);
      fetchSources();
    } catch {
      // keep dialog open
    }
  };
  const deleteSource = async (id: string) => {
    if (!confirm("Supprimer cette source ?")) return;
    try {
      const res = await fetch(`/api/veille/sources/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      fetchSources();
    } catch {
      // ignore
    }
  };

  const scoreFinal = (item: VeilleItem) => {
    const h = item.heuristic_score ?? 0;
    const v = item.similarity_score ?? 0;
    return (h + v) / 2;
  };

  const formatDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  const formatDateTime = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleString("fr-FR") : "—";

  return (
    <div className="w-full max-w-6xl mx-auto px-4 space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Bibliographie</h1>
        <p className="mt-2 text-muted-foreground">
          Parcourir les sites de publication scientifique pour récupérer les résumés d’articles. Chaque résumé est comparé aux données en base pour obtenir un score de similarité. Vous pouvez lancer une pipeline, consulter l’historique des runs et gérer les sources.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
        <Button
          variant={tab === "pipeline" ? "secondary" : "ghost"}
          size="sm"
          className="flex-1"
          onClick={() => setTab("pipeline")}
        >
          Recherche
        </Button>
        <Button
          variant={tab === "historique" ? "secondary" : "ghost"}
          size="sm"
          className="flex-1"
          onClick={() => setTab("historique")}
        >
          Historique
        </Button>
        <Button
          variant={tab === "sources" ? "secondary" : "ghost"}
          size="sm"
          className="flex-1"
          onClick={() => setTab("sources")}
        >
          Sources
        </Button>
      </div>

      {/* Pipeline */}
      {tab === "pipeline" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Lancer la recherche</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={startScrape} disabled={scraping || sources.length === 0}>
                {scraping ? "Lancement…" : "Lancer la recherche"}
              </Button>
              {runStatus && (
                <p className="text-sm text-muted-foreground">
                  Statut : <span className="font-medium">{runStatus}</span>
                  {runId && ` (run ${runId.slice(0, 8)}…)`}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Résultats de la recherche</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingItems ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun résultat. Lancez une recherche.</p>
              ) : (
                <div className="rounded border overflow-auto max-h-[70vh]">
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
                          <TableCell className="text-right text-xs">{scoreFinal(item).toFixed(2)}</TableCell>
                          <TableCell>{item.document_id ? "Oui" : "Non"}</TableCell>
                          <TableCell>
                            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-primary text-xs underline">
                              Lien
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Historique */}
      {tab === "historique" && (
        <Card>
          <CardHeader>
            <CardTitle>Historique des runs</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune run.</p>
            ) : (
              <div className="rounded border overflow-auto max-h-[70vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Statut</TableHead>
                      <TableHead className="text-right">Articles</TableHead>
                      <TableHead>Erreur</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{formatDateTime(r.started_at ?? r.created_at)}</TableCell>
                        <TableCell className="font-medium">{r.status}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.items_count ?? 0}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {r.error_message || "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="link" size="sm" className="h-auto p-0" asChild>
                            <Link href={`/bibliographie/historique/${r.id}`}>Voir les articles</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sources */}
      {tab === "sources" && (
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
              <p className="text-sm text-muted-foreground">Aucune source. Ajoutez une URL (flux RSS ou page HTML).</p>
            ) : (
              <div className="rounded border overflow-auto max-h-[70vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nom</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>Stratégie</TableHead>
                      <TableHead>Dernière vérif.</TableHead>
                      <TableHead className="w-32"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{s.name || "—"}</TableCell>
                        <TableCell className="max-w-xs truncate font-mono text-xs">{s.url}</TableCell>
                        <TableCell className="text-xs">{s.fetch_strategy ?? "auto"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{formatDate(s.last_checked_at)}</TableCell>
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
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                placeholder="https://… ou flux RSS"
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
            <div className="grid gap-2">
              <Label htmlFor="source-strategy">Stratégie</Label>
              <select
                id="source-strategy"
                className="rounded border bg-background px-3 py-2 text-sm"
                value={sourceFetchStrategy}
                onChange={(e) => setSourceFetchStrategy(e.target.value)}
              >
                <option value="auto">auto</option>
                <option value="fetch">fetch</option>
                <option value="rss">rss</option>
              </select>
              <p className="text-xs text-muted-foreground">
                auto = détection automatique ; fetch = HTML ; rss = flux RSS/Atom.
              </p>
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
