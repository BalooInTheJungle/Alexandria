"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TabId = "semaine" | "historique";

type VeilleRun = {
  id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  created_at?: string;
  items_count?: number;
  phase?: string | null;
  items_processed?: number | null;
  items_total?: number | null;
  ai_summary?: string | null;
  high_score_count?: number | null;
  score_threshold?: number | null;
};

type VeilleItem = {
  id: string;
  url: string;
  title: string | null;
  authors: string[] | null;
  abstract?: string | null;
  doi?: string | null;
  similarity_score: number | null;
  heuristic_score: number | null;
  source_name: string | null;
  document_id: string | null;
  published_at?: string | null;
};

const PHASE_LABELS: Record<string, string> = {
  sources: "Récupération RSS",
  urls:    "Enrichissement OpenAlex",
  items:   "Scoring des articles",
  summary: "Résumé IA",
  done:    "Terminé",
};

const PHASES = ["sources", "urls", "items", "summary"] as const;

const DEFAULT_THRESHOLD = 0.75;

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? "bg-green-100 text-green-800" : pct >= 50 ? "bg-yellow-100 text-yellow-800" : "bg-muted text-muted-foreground";
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>{pct}%</span>;
}

function ArticleCard({ item }: { item: VeilleItem }) {
  const href = item.doi ? `https://doi.org/${item.doi}` : item.url;
  const authors = item.authors?.slice(0, 3).join(", ") + (item.authors && item.authors.length > 3 ? " et al." : "");
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-sm hover:underline line-clamp-2">
            {item.title || "Sans titre"}
          </a>
          <p className="text-xs text-muted-foreground mt-0.5">{item.source_name || "—"}{authors ? ` · ${authors}` : ""}</p>
        </div>
        <ScoreBadge score={item.similarity_score} />
      </div>
      {item.abstract && (
        <p className="text-xs text-muted-foreground line-clamp-3">{item.abstract}</p>
      )}
      <div className="flex items-center justify-between mt-1">
        {item.document_id && (
          <span className="text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded">Dans le corpus</span>
        )}
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline ml-auto">
          Lire l'article →
        </a>
      </div>
    </Card>
  );
}

export default function BibliographiePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<TabId>("semaine");
  const [runs, setRuns] = useState<VeilleRun[]>([]);
  const [items, setItems] = useState<VeilleItem[]>([]);
  const [currentRun, setCurrentRun] = useState<VeilleRun | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<string | null>(null);
  const [runItemsProcessed, setRunItemsProcessed] = useState<number | null>(null);
  const [runItemsTotal, setRunItemsTotal] = useState<number | null>(null);
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const [pendingElapsed, setPendingElapsed] = useState<number>(0);
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);

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

  const fetchItems = useCallback(async (runIdFilter?: string, minScore?: number) => {
    setLoadingItems(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (runIdFilter) params.set("runId", runIdFilter);
      if (minScore !== undefined) params.set("minScore", String(minScore));
      const res = await fetch(`/api/veille/items?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const fetchCurrentRun = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/veille/runs/${id}`);
      if (!res.ok) return;
      const run = await res.json();
      setCurrentRun(run);
      return run as VeilleRun;
    } catch {
      return null;
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Load last completed run's items on mount
  useEffect(() => {
    if (runs.length === 0) return;
    const lastCompleted = runs.find(r => r.status === "completed");
    if (lastCompleted && !runId) {
      fetchCurrentRun(lastCompleted.id).then(run => {
        if (run) {
          setCurrentRun(run);
          const thresh = run.score_threshold ?? DEFAULT_THRESHOLD;
          setThreshold(thresh);
          fetchItems(lastCompleted.id, thresh);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  // Reload items when threshold changes (only if run is completed)
  useEffect(() => {
    if (currentRun?.status === "completed") {
      fetchItems(currentRun.id, threshold);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold]);

  // Elapsed timer
  useEffect(() => {
    if (!pendingSince || (runStatus !== "pending" && runStatus !== "running")) {
      setPendingElapsed(0);
      return;
    }
    const tick = () => setPendingElapsed(Math.round((Date.now() - pendingSince) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pendingSince, runStatus]);

  // URL param: restore run from ?run=xxx
  useEffect(() => {
    const runFromUrl = searchParams.get("run");
    if (!runFromUrl || runFromUrl === runId) return;
    fetch(`/api/veille/runs/${runFromUrl}`)
      .then(r => r.ok ? r.json() : null)
      .then(run => {
        if (!run) return;
        setRunId(run.id);
        setRunStatus(run.status);
        setRunPhase(run.phase ?? null);
        setRunItemsProcessed(run.items_processed ?? null);
        setRunItemsTotal(run.items_total ?? null);
        if (run.status === "running" || run.status === "pending") {
          setScraping(true);
          setPendingSince(run.started_at ? new Date(run.started_at).getTime() : Date.now());
          pollRunStatus(run.id);
        } else {
          setCurrentRun(run);
          const thresh = run.score_threshold ?? DEFAULT_THRESHOLD;
          setThreshold(thresh);
          fetchItems(run.id, thresh);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("run")]);

  const pollRunStatus = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/veille/runs/${id}`);
      if (!res.ok) return;
      const run: VeilleRun = await res.json();
      setRunStatus(run.status);
      setRunPhase(run.phase ?? null);
      setRunItemsProcessed(run.items_processed ?? null);
      setRunItemsTotal(run.items_total ?? null);

      if (run.status === "running" || run.status === "pending") {
        setTimeout(() => pollRunStatus(id), 2000);
      } else {
        setScraping(false);
        setPendingSince(null);
        setRunPhase(null);
        setRunItemsProcessed(null);
        setRunItemsTotal(null);
        setCurrentRun(run);
        const thresh = run.score_threshold ?? DEFAULT_THRESHOLD;
        setThreshold(thresh);
        fetchRuns();
        fetchItems(id, thresh);
      }
    },
    [fetchRuns, fetchItems]
  );

  const startScrape = async () => {
    setScraping(true);
    setRunStatus("pending");
    setRunId(null);
    setCurrentRun(null);
    setItems([]);
    setPendingSince(Date.now());
    console.log("[bibliographie] starting scrape");
    try {
      const res = await fetch("/api/veille/scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      console.log("[bibliographie] scrape response", { runId: data.runId, message: data.message });
      if (data.runId) {
        setRunId(data.runId);
        setRunStatus(data.status ?? "pending");
        setPendingSince(Date.now());
        router.replace(`/bibliographie?run=${data.runId}`, { scroll: false });
        pollRunStatus(data.runId);
      } else {
        setScraping(false);
        setPendingSince(null);
      }
    } catch (err) {
      console.error("[bibliographie] scrape error", err);
      setScraping(false);
      setPendingSince(null);
    }
  };

  const stopScrape = async () => {
    if (!runId) return;
    await fetch(`/api/veille/runs/${runId}/stop`, { method: "POST" });
  };

  const formatDateTime = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleString("fr-FR") : "—";

  const isRunning = runStatus === "running" || runStatus === "pending";

  return (
    <div className="w-full max-w-6xl mx-auto px-4 space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Bibliographie</h1>
        <p className="mt-2 text-muted-foreground">
          Veille automatisée sur les journaux scientifiques. Chaque article est comparé au corpus pour obtenir un score de similarité.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-border p-1 bg-muted/30">
        <Button variant={tab === "semaine" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab("semaine")}>
          Cette semaine
        </Button>
        <Button variant={tab === "historique" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab("historique")}>
          Historique
        </Button>
      </div>

      {/* ── Tab : Cette semaine ── */}
      {tab === "semaine" && (
        <div className="space-y-4">

          {/* Card : Lancer / progression */}
          <Card>
            <CardHeader>
              <CardTitle>Lancer la recherche</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Button onClick={startScrape} disabled={scraping}>
                  {scraping ? "En cours…" : "Lancer la recherche"}
                </Button>
                {scraping && runStatus === "running" && runId && (
                  <Button variant="outline" size="sm" onClick={stopScrape}>Arrêter</Button>
                )}
              </div>

              {runStatus && (
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Statut : <span className="font-medium text-foreground">{runStatus}</span>
                    {runId && <> · <Link href={`/bibliographie?run=${runId}`} className="text-primary underline">run {runId.slice(0, 8)}…</Link></>}
                    {pendingElapsed > 0 && isRunning && <span className="ml-2">— {pendingElapsed} s</span>}
                  </p>

                  {isRunning && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {PHASES.map((p) => {
                          const idx = PHASES.indexOf(p);
                          const currentIdx = runPhase ? PHASES.indexOf(runPhase as typeof PHASES[number]) : -1;
                          const done = idx < currentIdx || runPhase === "done";
                          const current = runPhase === p;
                          return (
                            <span key={p} className={`rounded px-2 py-0.5 text-xs ${current ? "bg-primary text-primary-foreground" : done ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"}`}>
                              {done ? "✓ " : ""}{PHASE_LABELS[p]}
                            </span>
                          );
                        })}
                      </div>
                      {runPhase === "items" && runItemsTotal != null && runItemsTotal > 0 && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>Scoring des articles</span>
                            <span>{runItemsProcessed ?? 0} / {runItemsTotal}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${Math.min(100, ((runItemsProcessed ?? 0) / runItemsTotal) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card : Résumé IA */}
          {currentRun?.ai_summary && !isRunning && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Résumé de la semaine</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {currentRun.high_score_count ?? 0} articles pertinents
                    {currentRun.score_threshold != null && ` (score ≥ ${Math.round(currentRun.score_threshold * 100)}%)`}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm leading-relaxed space-y-2">
                  {currentRun.ai_summary.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>;
                    if (line.startsWith('**') && line.includes('**')) {
                      const [bold, ...rest] = line.replace(/^\*\*/, '').split('**');
                      return <p key={i}><strong>{bold}</strong>{rest.join('')}</p>;
                    }
                    if (line.trim() === '') return null;
                    return <p key={i}>{line}</p>;
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Articles cités dans le résumé IA */}
          {currentRun?.ai_summary && !isRunning && items.length > 0 && (
            <Card className="border-primary/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Articles cités cette semaine — accès direct
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-1">
                  {items.slice(0, 10).map((item, i) => {
                    const href = item.doi ? `https://doi.org/${item.doi}` : item.url;
                    const score = item.similarity_score != null ? Math.round(item.similarity_score * 100) : null;
                    return (
                      <li key={item.id} className="flex items-baseline gap-2 text-sm">
                        <span className="text-muted-foreground tabular-nums w-5 shrink-0">{i + 1}.</span>
                        <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline text-primary flex-1 min-w-0 truncate">
                          {item.title || "Sans titre"}
                        </a>
                        <span className="text-xs text-muted-foreground shrink-0">{item.source_name}</span>
                        {score != null && (
                          <span className="text-xs font-medium shrink-0">{score}%</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* Slider seuil + articles */}
          {!isRunning && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-base">
                    Articles pertinents
                    {items.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({items.length} affichés)</span>}
                  </CardTitle>
                  <div className="flex items-center gap-3 text-sm">
                    <label className="text-muted-foreground whitespace-nowrap">
                      Seuil : <span className="font-medium text-foreground">{Math.round(threshold * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min={0.3}
                      max={0.9}
                      step={0.05}
                      value={threshold}
                      onChange={e => setThreshold(parseFloat(e.target.value))}
                      className="w-32 accent-primary"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingItems ? (
                  <p className="text-sm text-muted-foreground">Chargement…</p>
                ) : items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun article au-dessus du seuil. Baissez le seuil ou lancez une nouvelle recherche.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                    {items.map(item => <ArticleCard key={item.id} item={item} />)}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Tab : Historique ── */}
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
                      <TableHead className="text-right">Pertinents</TableHead>
                      <TableHead>Erreur</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{formatDateTime(r.started_at ?? r.created_at)}</TableCell>
                        <TableCell className="font-medium">{r.status}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.items_count ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.high_score_count != null
                            ? `${r.high_score_count}${r.score_threshold != null ? ` (≥${Math.round(r.score_threshold * 100)}%)` : ""}`
                            : "—"}
                        </TableCell>
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
    </div>
  );
}
