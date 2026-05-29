"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VeilleArticleCard from "./VeilleArticleCard";

// ─── Publisher detection from DOI prefix ──────────────────────────────────────

const DOI_PUBLISHERS: Array<{ prefix: string; label: string }> = [
  { prefix: "10.1021/", label: "ACS" },
  { prefix: "10.1039/", label: "RSC" },
  { prefix: "10.1002/", label: "Wiley" },
  { prefix: "10.1038/", label: "Nature" },
  { prefix: "10.1103/", label: "APS" },
  { prefix: "10.1016/", label: "Elsevier" },
  { prefix: "10.1007/", label: "Springer" },
  { prefix: "10.3390/", label: "MDPI" },
];

function getPublisher(doi: string | null): string {
  if (!doi) return "Autre";
  for (const { prefix, label } of DOI_PUBLISHERS) {
    if (doi.startsWith(prefix)) return label;
  }
  return "Autre";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface VeilleItem {
  id: string;
  title: string;
  authors: string[];
  doi: string | null;
  abstract: string | null;
  url: string;
  published_at: string | null;
  similarity_score: number | null;
  last_error: string | null;
}

interface RunSummary {
  id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  total: number;
  scored: number;
  best: number | null;
  avg: number | null;
  ai_summary: string | null;
  high_score_count: number | null;
  score_threshold: number | null;
}

interface LiveStatus {
  run_id: string;
  status: string;
  started_at: string;
  item_count: number;
  scored_count: number;
  error_message: string | null;
}

type Tab = "results" | "live" | "history";

const POLL_MS = 4000;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running:   "bg-blue-500 animate-pulse",
    completed: "bg-green-500",
    failed:    "bg-red-500",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? "bg-gray-400"}`} />;
}

function RunRow({ run, onSelect }: { run: RunSummary; onSelect?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(run.started_at).toLocaleString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  const duration = run.completed_at
    ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
    : null;

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-4 px-4 py-3 text-sm">
        <StatusDot status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">{date}</span>
            {duration && <span className="text-muted-foreground text-xs">{duration}s</span>}
          </div>
          {run.error_message && (
            <p className="text-xs text-destructive truncate">{run.error_message}</p>
          )}
        </div>
        <div className="text-right text-xs text-muted-foreground shrink-0">
          {run.total > 0 ? (
            <>
              <div>{run.total} articles</div>
              {run.high_score_count !== null && run.score_threshold !== null && (
                <div>{run.high_score_count} ≥ {Math.round((run.score_threshold) * 100)}%</div>
              )}
            </>
          ) : (
            <div>—</div>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {run.ai_summary && (
            <Button size="sm" variant="ghost" onClick={() => setExpanded(e => !e)} className="text-xs h-7">
              {expanded ? "Masquer" : "Résumé IA"}
            </Button>
          )}
          {onSelect && run.status === "completed" && run.total > 0 && (
            <Button size="sm" variant="outline" onClick={onSelect} className="text-xs h-7">
              Voir
            </Button>
          )}
        </div>
      </div>
      {expanded && run.ai_summary && (
        <div className="px-4 pb-4">
          <div className="rounded-md bg-muted/50 p-3 text-xs text-foreground whitespace-pre-wrap leading-relaxed">
            {run.ai_summary}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VeilleDashboard() {
  const [tab, setTab] = useState<Tab>("results");
  const [articles, setArticles] = useState<VeilleItem[]>([]);
  const [runDate, setRunDate] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedRef = useRef<NodeJS.Timeout | null>(null);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterText, setFilterText] = useState("");
  const [filterScore, setFilterScore] = useState<number>(0);
  const [filterPublisher, setFilterPublisher] = useState<string>("");
  const [filterDays, setFilterDays] = useState<number>(0);

  const publishers = useMemo(() => {
    const set = new Set(articles.map(a => getPublisher(a.doi)));
    return Array.from(set).sort();
  }, [articles]);

  const filteredArticles = useMemo(() => {
    const now = Date.now();
    const text = filterText.toLowerCase();
    return articles.filter(a => {
      if (filterScore > 0 && (a.similarity_score ?? 0) < filterScore) return false;
      if (filterPublisher && getPublisher(a.doi) !== filterPublisher) return false;
      if (filterDays > 0 && a.published_at) {
        const age = (now - new Date(a.published_at).getTime()) / 86400000;
        if (age > filterDays) return false;
      }
      if (text) {
        const inTitle = a.title.toLowerCase().includes(text);
        const inAuthors = a.authors.some(au => au.toLowerCase().includes(text));
        if (!inTitle && !inAuthors) return false;
      }
      return true;
    });
  }, [articles, filterText, filterScore, filterPublisher, filterDays]);

  const hasActiveFilters = filterText || filterScore > 0 || filterPublisher || filterDays > 0;

  // ── Fetch articles from last completed run ─────────────────────────────────
  const fetchList = useCallback(async () => {
    const res = await fetch("/api/veille/list?limit=200");
    if (!res.ok) return;
    const json = await res.json();
    setArticles(json.items ?? []);
    setRunDate(json.run_date ?? null);
    setLoadingList(false);
  }, []);

  // ── Fetch run history ──────────────────────────────────────────────────────
  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    const res = await fetch("/api/veille/runs");
    if (res.ok) {
      const json = await res.json();
      const raw = Array.isArray(json) ? json : (json.runs ?? []);
      setRuns(raw.map((r: any) => ({
        id: r.id,
        status: r.status,
        started_at: r.started_at,
        completed_at: r.completed_at,
        error_message: r.error_message,
        total: r.items_count ?? 0,
        scored: r.scored ?? 0,
        best: r.best ?? null,
        avg: r.avg ?? null,
        ai_summary: r.ai_summary ?? null,
        high_score_count: r.high_score_count ?? null,
        score_threshold: r.score_threshold ?? null,
      })));
    }
    setLoadingRuns(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { if (tab === "history") fetchRuns(); }, [tab, fetchRuns]);

  // ── Elapsed timer while running ────────────────────────────────────────────
  useEffect(() => {
    if (runningId) {
      setElapsedSeconds(0);
      elapsedRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    } else {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [runningId]);

  // ── Poll live status ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!runningId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/veille/status/${runningId}`);
      if (!res.ok) return;
      const status: LiveStatus = await res.json();
      setLiveStatus(status);
      if (status.status === "completed" || status.status === "failed") {
        clearInterval(interval);
        setRunningId(null);
        fetchList();
        fetchRuns();
        if (status.status === "completed") setTab("results");
      }
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [runningId, fetchList, fetchRuns]);

  // ── Trigger pipeline ───────────────────────────────────────────────────────
  async function handleTrigger() {
    setTriggerError(null);
    setLiveStatus(null);
    const res = await fetch("/api/veille/scrape", { method: "POST" });
    const json = await res.json();
    if (!res.ok) { setTriggerError(json.error ?? "Erreur inconnue"); return; }
    if (json.run_id) {
      setRunningId(json.run_id);
      setTab("live");
    }
  }

  const isRunning = !!runningId;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold">Bibliographie</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
              Parcourez les dernières publications récupérées automatiquement depuis 43 journaux scientifiques. Chaque article est scoré par similarité avec votre corpus pour identifier les plus pertinents.
            </p>
            {runDate && (
              <p className="mt-1 text-xs text-muted-foreground">
                Dernier run : {new Date(runDate).toLocaleString("fr-FR")}
              </p>
            )}
          </div>
          <Button onClick={handleTrigger} disabled={isRunning} size="sm" className="shrink-0 mt-1">
            {isRunning ? "Pipeline en cours…" : "Lancer la veille"}
          </Button>
        </div>
      </div>

      {triggerError && (
        <p className="px-6 py-2 text-sm text-destructive border-b border-border">{triggerError}</p>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-border px-6 gap-1">
        {[
          { id: "results" as Tab, label: `Résultats${articles.length ? ` (${articles.length})` : ""}` },
          { id: "live"    as Tab, label: isRunning ? "⬤ En cours" : "En cours" },
          { id: "history" as Tab, label: "Historique" },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === id
                ? "border-foreground text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── Résultats ─────────────────────────────────────────────────── */}
        {tab === "results" && (
          <div className="px-6 py-4">
            {loadingList ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : articles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun article. Lancez la veille pour récupérer les publications récentes.
              </p>
            ) : (
              <div className="space-y-4 max-w-3xl">
                {/* Filter bar */}
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    placeholder="Titre, auteur…"
                    value={filterText}
                    onChange={e => setFilterText(e.target.value)}
                    className="h-8 w-48 text-sm"
                  />
                  <select
                    value={filterScore}
                    onChange={e => setFilterScore(Number(e.target.value))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value={0}>Tous les scores</option>
                    <option value={0.3}>&gt; 30%</option>
                    <option value={0.5}>&gt; 50%</option>
                    <option value={0.7}>&gt; 70%</option>
                  </select>
                  <select
                    value={filterPublisher}
                    onChange={e => setFilterPublisher(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="">Tous les éditeurs</option>
                    {publishers.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <select
                    value={filterDays}
                    onChange={e => setFilterDays(Number(e.target.value))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value={0}>Toutes les dates</option>
                    <option value={3}>3 derniers jours</option>
                    <option value={7}>7 derniers jours</option>
                  </select>
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => {
                        setFilterText("");
                        setFilterScore(0);
                        setFilterPublisher("");
                        setFilterDays(0);
                      }}
                    >
                      Réinitialiser
                    </Button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  {filteredArticles.length} article{filteredArticles.length !== 1 ? "s" : ""}
                  {hasActiveFilters ? ` sur ${articles.length}` : ""}, triés par pertinence
                </p>

                {filteredArticles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun article ne correspond aux filtres.</p>
                ) : (
                  filteredArticles.map(a => <VeilleArticleCard key={a.id} article={a} />)
                )}
              </div>
            )}
          </div>
        )}

        {/* ── En cours ──────────────────────────────────────────────────── */}
        {tab === "live" && (
          <div className="px-6 py-8 max-w-lg">
            {!isRunning && !liveStatus ? (
              <p className="text-sm text-muted-foreground">
                Aucun pipeline en cours. Cliquez sur « Lancer la veille » pour démarrer.
              </p>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <StatusDot status={liveStatus?.status ?? "running"} />
                  <span className="text-sm font-medium">
                    {isRunning ? "Pipeline en cours" : liveStatus?.status === "completed" ? "Terminé" : "Échoué"}
                  </span>
                  {isRunning && (
                    <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                      {elapsedSeconds}s
                    </span>
                  )}
                </div>

                {liveStatus && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border p-4 text-center">
                      <div className="text-2xl font-bold tabular-nums">{liveStatus.item_count}</div>
                      <div className="text-xs text-muted-foreground mt-1">articles insérés</div>
                    </div>
                    <div className="rounded-lg border border-border p-4 text-center">
                      <div className="text-2xl font-bold tabular-nums">{liveStatus.scored_count}</div>
                      <div className="text-xs text-muted-foreground mt-1">scorés</div>
                    </div>
                  </div>
                )}

                {isRunning && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">Phases :</div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">✓</span> Fetch RSS (43 sources, 5 en parallèle)
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={liveStatus && liveStatus.item_count > 0 ? "text-green-600" : "text-muted-foreground"}>
                          {liveStatus && liveStatus.item_count > 0 ? "✓" : "○"}
                        </span>
                        Enrichissement OpenAlex (batch 50 DOIs)
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={liveStatus && liveStatus.item_count > 0 ? "text-green-600" : "text-muted-foreground"}>
                          {liveStatus && liveStatus.item_count > 0 ? "✓" : "○"}
                        </span>
                        Insertion DB
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={liveStatus && liveStatus.scored_count > 0 ? "text-green-600" : "text-muted-foreground"}>
                          {liveStatus && liveStatus.scored_count > 0 ? "✓" : "○"}
                        </span>
                        Scoring similarité corpus
                      </div>
                    </div>
                  </div>
                )}

                {liveStatus?.error_message && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {liveStatus.error_message}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Historique ────────────────────────────────────────────────── */}
        {tab === "history" && (
          <div>
            {loadingRuns ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">Chargement…</p>
            ) : runs.length === 0 ? (
              <p className="px-6 py-4 text-sm text-muted-foreground">Aucun run enregistré.</p>
            ) : (
              <div>
                <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                  {runs.length} runs — {runs.filter(r => r.status === "completed").length} complétés
                </div>
                {runs.map(run => (
                  <RunRow
                    key={run.id}
                    run={run}
                    onSelect={() => setTab("results")}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
