"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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

// ── Types ──────────────────────────────────────────────────────────────────────

type RunLogEntry = {
  ts:    string
  level: 'info' | 'warn' | 'error'
  phase: string
  msg:   string
}

type VeilleRun = {
  id: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  ai_summary?: string | null;
  high_score_count?: number | null;
  score_threshold?: number | null;
  pipeline_logs?: RunLogEntry[];
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
};

// ── Summary parsing + rendering (mirrors /bibliographie) ──────────────────────

type SummaryTheme   = { title: string; description: string }
type SummaryArticle = { item_id: string; contribution: string; relevance: string; corpus_link: string }
type StructuredSummary = { themes: SummaryTheme[]; articles: SummaryArticle[] }

function parseSummary(raw: string): StructuredSummary | null {
  try {
    const p = JSON.parse(raw)
    if (p && Array.isArray(p.themes) && Array.isArray(p.articles)) return p as StructuredSummary
    return null
  } catch { return null }
}

const THEME_COLORS = [
  "bg-blue-50 border-blue-200 text-blue-900",
  "bg-violet-50 border-violet-200 text-violet-900",
  "bg-teal-50 border-teal-200 text-teal-900",
];

function StructuredSummaryView({ summary, run, items }: { summary: StructuredSummary; run: VeilleRun; items: VeilleItem[] }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Résumé de la veille</h2>
        <span className="text-sm text-muted-foreground">
          {run.high_score_count ?? 0} articles pertinents
          {run.score_threshold != null && ` (score ≥ ${Math.round(run.score_threshold * 100)}%)`}
        </span>
      </div>

      {summary.themes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Thèmes émergents</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.themes.map((theme, i) => (
              <div key={i} className={`rounded-lg border p-3 space-y-1 ${THEME_COLORS[i % THEME_COLORS.length]}`}>
                <p className="text-sm font-semibold">{theme.title}</p>
                <p className="text-xs leading-relaxed opacity-80">{theme.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.articles.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Articles analysés ({summary.articles.length})
          </p>
          <div className="flex flex-col gap-3">
            {summary.articles.map((article, i) => {
              const item = items.find(it => it.id === article.item_id)
              const href = item?.url ?? null
              const title = item?.title ?? "(titre inconnu)"
              const source = item?.source_name ?? "—"
              return (
                <Card key={i} className="p-4 space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">{source}</p>
                    {href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline line-clamp-2 block">{title}</a>
                      : <p className="text-sm font-semibold line-clamp-2">{title}</p>
                    }
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contribution</p>
                      <p className="leading-relaxed">{article.contribution}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pertinence</p>
                      <p className="leading-relaxed">{article.relevance}</p>
                    </div>
                    <div className="bg-blue-50/60 rounded-md p-3 border border-blue-100">
                      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Lien avec le corpus</p>
                      <p className="text-sm leading-relaxed text-blue-900">{article.corpus_link}</p>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function LegacySummaryView({ raw, run }: { raw: string; run: VeilleRun }) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Résumé de la veille</span>
          <span className="text-sm font-normal text-muted-foreground">
            {run.high_score_count ?? 0} articles pertinents
            {run.score_threshold != null && ` (score ≥ ${Math.round(run.score_threshold * 100)}%)`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm leading-relaxed space-y-2">
          {raw.split('\n').map((line, i) => {
            if (line.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>
            if (line.startsWith('**') && line.includes('**')) {
              const [bold, ...rest] = line.replace(/^\*\*/, '').split('**')
              return <p key={i}><strong>{bold}</strong>{rest.join('')}</p>
            }
            if (line.trim() === '') return null
            return <p key={i}>{line}</p>
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Pipeline logs ─────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  sources: 'Sources RSS',
  urls:    'Enrichissement',
  insert:  'Insertion',
  scoring: 'Scoring',
  summary: 'Résumé IA',
  done:    'Terminé',
  fatal:   'Erreur fatale',
}

const LEVEL_STYLES: Record<string, string> = {
  info:  'text-foreground',
  warn:  'text-amber-600',
  error: 'text-red-600 font-medium',
}

const PHASE_BADGE: Record<string, string> = {
  sources: 'bg-blue-100 text-blue-700',
  urls:    'bg-indigo-100 text-indigo-700',
  insert:  'bg-teal-100 text-teal-700',
  scoring: 'bg-purple-100 text-purple-700',
  summary: 'bg-orange-100 text-orange-700',
  done:    'bg-green-100 text-green-700',
  fatal:   'bg-red-100 text-red-700',
}

function PipelineLogsView({ logs }: { logs: RunLogEntry[] }) {
  if (logs.length === 0) return (
    <Card>
      <CardHeader><CardTitle className="text-base">Logs pipeline</CardTitle></CardHeader>
      <CardContent><p className="text-sm text-muted-foreground">Aucun log disponible pour cette run (exécutée avant la mise à jour).</p></CardContent>
    </Card>
  )

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Logs pipeline</CardTitle></CardHeader>
      <CardContent>
        <div className="font-mono text-xs space-y-1 max-h-72 overflow-y-auto">
          {logs.map((entry, i) => {
            const time = new Date(entry.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            const badge = PHASE_BADGE[entry.phase] ?? 'bg-gray-100 text-gray-700'
            const textStyle = LEVEL_STYLES[entry.level] ?? 'text-foreground'
            return (
              <div key={i} className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0 w-16">{time}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>
                  {PHASE_LABELS[entry.phase] ?? entry.phase}
                </span>
                <span className={textStyle}>{entry.msg}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HistoriqueRunPage({ params }: { params: { runId: string } }) {
  const { runId } = params;
  const [items, setItems] = useState<VeilleItem[]>([]);
  const [run, setRun] = useState<VeilleRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [itemsRes, runRes] = await Promise.all([
          fetch(`/api/veille/items?runId=${encodeURIComponent(runId)}&limit=200`),
          fetch(`/api/veille/runs/${runId}`),
        ]);
        if (!cancelled && itemsRes.ok) {
          const data = await itemsRes.json();
          setItems(Array.isArray(data) ? data : []);
        }
        if (!cancelled && runRes.ok) {
          setRun(await runRes.json());
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  const scoreFinal = (item: VeilleItem) => item.similarity_score ?? 0;

  return (
    <div className="w-full max-w-6xl mx-auto px-4 space-y-6 py-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/bibliographie">← Bibliographie</Link>
        </Button>
      </div>

      {/* Résumé IA */}
      {run?.ai_summary && !loading && (() => {
        const structured = parseSummary(run.ai_summary)
        if (structured) return <StructuredSummaryView summary={structured} run={run} items={items} />
        return <LegacySummaryView raw={run.ai_summary} run={run} />
      })()}

      {/* Logs pipeline */}
      {!loading && <PipelineLogsView logs={run?.pipeline_logs ?? []} />}

      {/* Tableau des articles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Run {runId.slice(0, 8)}…</CardTitle>
          {run?.status && (
            <span className="text-sm font-medium text-muted-foreground">Statut : {run.status}</span>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun article pour cette run.</p>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
