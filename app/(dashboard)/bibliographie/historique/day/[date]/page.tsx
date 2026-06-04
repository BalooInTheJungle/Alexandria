"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ──────────────────────────────────────────────────────────────────────

type RunLogEntry = { ts: string; level: 'info' | 'warn' | 'error'; phase: string; msg: string }

type DayRun = {
  id: string;
  status: string;
  phase?: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  ai_summary?: string | null;
  pipeline_logs?: RunLogEntry[];
}

type DayItem = {
  id: string;
  run_id: string;
  url: string;
  title: string | null;
  authors: string[] | null;
  doi: string | null;
  abstract?: string | null;
  similarity_score: number | null;
  heuristic_score: number | null;
  source_name: string | null;
  read_at: string | null;
  ai_analysis?: { contribution: string; relevance: string; corpus_link: string } | null;
}

type DayData = {
  date: string;
  runs: DayRun[];
  items: DayItem[];
  stats: { total: number; scored: number; pertinent: number; runsCount: number };
  dailySummary?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: string) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

function statusStyle(status: string) {
  if (status === "completed") return "bg-green-100 text-green-700";
  if (status === "failed")    return "bg-red-100 text-red-700";
  return "bg-yellow-100 text-yellow-700";
}

function logLevelStyle(level: string) {
  if (level === "error") return "text-red-600";
  if (level === "warn")  return "text-orange-500";
  return "text-foreground";
}

function scoreColor(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.80) return "text-green-700 font-semibold";
  if (score >= 0.75) return "text-green-600";
  return "text-muted-foreground";
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DayDetailPage() {
  const params  = useParams();
  const date    = params.date as string;
  const [data, setData]       = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [refreshing, setRefreshing]       = useState(false);
  const [logsOpen, setLogsOpen]           = useState<string | null>(null);  // run id with open logs
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!date) return;

    const isToday = date === new Date().toISOString().slice(0, 10);

    const load = (initial = false) => {
      if (initial) setLoading(true);
      fetch(`/api/veille/days/${date}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
        .then(setData)
        .catch(e => setError(String(e)))
        .finally(() => { if (initial) setLoading(false); });
    };

    load(true);

    // Today: poll every 15s (new runs can arrive any time)
    // Past days: poll every 10s only while a run is still running
    const interval = setInterval(() => {
      setData(prev => {
        const hasRunning = prev?.runs.some(r => r.status === 'running');
        if (isToday || hasRunning) load(false);
        return prev;
      });
    }, 15000);

    return () => clearInterval(interval);
  }, [date]);

  if (loading) return <div className="p-8 text-muted-foreground">Chargement…</div>;
  if (error)   return <div className="p-8 text-red-500">Erreur : {error}</div>;
  if (!data)   return null;

  const pertinentItems = data.items.filter(i => (i.similarity_score ?? 0) >= 0.75);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 space-y-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/bibliographie?tab=historique">
            <Button variant="ghost" size="sm">← Historique</Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold capitalize">{formatDate(date)}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {data.stats.runsCount} run{data.stats.runsCount > 1 ? "s" : ""} · {data.stats.total} articles extraits · {data.stats.pertinent} pertinents ≥75%
            </p>
          </div>
        </div>
        <Button
          variant="outline" size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            fetch(`/api/veille/days/${date}`)
              .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
              .then(setData)
              .catch(() => {})
              .finally(() => setRefreshing(false));
          }}
        >
          {refreshing ? "…" : "↻ Rafraîchir"}
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Articles extraits", value: data.stats.total },
          { label: "Articles scorés", value: data.stats.scored },
          { label: "Pertinents ≥75%", value: data.stats.pertinent, green: true },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <p className={`text-3xl font-bold mt-1 ${k.green ? "text-green-700" : ""}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Runs du jour */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs de la journée</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.runs.map(run => (
            <div key={run.id} className="border rounded-lg overflow-hidden">
              {/* Run header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusStyle(run.status)}`}>
                    {run.status}
                  </span>
                  <span className="text-sm font-medium">
                    {formatTime(run.started_at)} → {formatTime(run.completed_at)}
                  </span>
                  {run.ai_summary && (
                    <span className="text-xs font-semibold text-violet-600 px-2 py-0.5 rounded-full bg-violet-50">
                      ✦ Résumé IA consolidé
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/bibliographie/historique/${run.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs">Détail run →</Button>
                  </Link>
                  <Button
                    variant="ghost" size="sm" className="text-xs"
                    onClick={() => setLogsOpen(logsOpen === run.id ? null : run.id)}
                  >
                    {logsOpen === run.id ? "Masquer logs" : "Voir logs"}
                  </Button>
                </div>
              </div>

              {/* Pipeline logs accordion */}
              {logsOpen === run.id && (
                <div className="bg-zinc-950 text-zinc-100 font-mono text-xs p-4 max-h-80 overflow-y-auto space-y-0.5">
                  {run.pipeline_logs && run.pipeline_logs.length > 0 ? (
                    run.pipeline_logs.map((log, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="text-zinc-500 shrink-0">{new Date(log.ts).toLocaleTimeString("fr-FR")}</span>
                        <span className={`shrink-0 w-16 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-orange-400' : 'text-zinc-400'}`}>
                          [{log.phase}]
                        </span>
                        <span className={logLevelStyle(log.level)}>{log.msg}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-zinc-500">Aucun log disponible pour ce run.</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Résumé IA consolidé */}
      {data.dailySummary && (() => {
        try {
          const s = JSON.parse(data.dailySummary);
          return (
            <Card className="border-violet-200">
              <CardHeader>
                <CardTitle className="text-base text-violet-700">✦ Résumé IA du jour</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {s.themes?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Thèmes émergents</p>
                    {s.themes.map((t: any, i: number) => (
                      <div key={i} className="border-l-2 border-violet-300 pl-3">
                        <p className="text-sm font-semibold">{t.title}</p>
                        <p className="text-sm text-muted-foreground">{t.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        } catch { return null; }
      })()}

      {/* Articles pertinents du jour */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Articles pertinents du jour ({pertinentItems.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pertinentItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun article pertinent aujourd'hui.</p>
          ) : (
            <div className="space-y-2">
              {pertinentItems.map(item => {
                const expanded = expandedItems.has(item.id);
                return (
                  <div key={item.id} className="border rounded-lg overflow-hidden">
                    <div
                      className="flex items-start justify-between gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedItems(prev => {
                        const next = new Set(prev);
                        next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                        return next;
                      })}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">{item.title ?? "Sans titre"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.source_name ?? "—"}
                          {item.authors?.length ? ` · ${item.authors.slice(0, 2).join(", ")}${item.authors.length > 2 ? " et al." : ""}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {item.ai_analysis && (
                          <span className="text-xs font-semibold text-violet-600 px-1.5 py-0.5 rounded bg-violet-50">✦ IA</span>
                        )}
                        <span className={`text-sm tabular-nums ${scoreColor(item.similarity_score)}`}>
                          {item.similarity_score != null ? `${Math.round(item.similarity_score * 100)}%` : "—"}
                        </span>
                        <a
                          href={item.url || (item.doi ? `https://doi.org/${item.doi}` : "#")}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          DOI →
                        </a>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {expanded && (
                      <div className="border-t px-4 py-3 bg-muted/10 space-y-3">
                        {item.abstract && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{item.abstract.slice(0, 500)}{item.abstract.length > 500 ? "…" : ""}</p>
                        )}
                        {item.ai_analysis && (
                          <div className="space-y-1.5 rounded-lg bg-violet-50 border border-violet-100 p-3">
                            <p className="text-xs font-semibold text-violet-700">Analyse IA</p>
                            <p className="text-xs text-violet-900"><span className="font-medium">Contribution :</span> {item.ai_analysis.contribution}</p>
                            <p className="text-xs text-violet-900"><span className="font-medium">Pertinence :</span> {item.ai_analysis.relevance}</p>
                            <p className="text-xs text-blue-800"><span className="font-medium">Lien corpus :</span> {item.ai_analysis.corpus_link}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
