"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ── Types ──────────────────────────────────────────────────────────────────────

type RunLogEntry = {
  ts:    string
  level: 'info' | 'warn' | 'error'
  phase: string
  msg:   string
}

type CorpusRef = {
  doc_id:    string;
  doc_title: string | null;
  excerpt:   string | null;
  page:      number | null;
  similarity: number;
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
  doi: string | null;
  heuristic_score: number | null;
  similarity_score: number | null;
  source_name: string | null;
  document_id: string | null;
  corpus_refs?: CorpusRef[] | null;
};

// ── Shared UI components ───────────────────────────────────────────────────────

function ScoreStat({ score }: { score: number | null }) {
  if (score == null) return (
    <div className="flex flex-col items-center justify-center rounded-lg px-3 py-2 bg-muted min-w-[68px]">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Similarité</span>
      <span className="text-lg font-bold text-muted-foreground">—</span>
    </div>
  );
  const pct = Math.round(score * 100);
  const colors = pct >= 70 ? "bg-green-100 text-green-800" : pct >= 50 ? "bg-yellow-100 text-yellow-800" : "bg-muted text-muted-foreground";
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg px-3 py-2 min-w-[68px] ${colors}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Similarité</span>
      <span className="text-xl font-bold tabular-nums leading-tight">{pct}%</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-muted-foreground shrink-0 w-24">{label} :</span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

function CorpusRefBlock({ corpusRef }: { corpusRef: CorpusRef }) {
  const pct = Math.round((corpusRef.similarity ?? 0) * 100);
  const scoreColor = pct >= 70 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-muted-foreground";
  return (
    <div className="bg-muted/50 rounded-md p-3 space-y-2 border border-border">
      <div className="space-y-1">
        <Field label="Document"><span className="font-medium">{corpusRef.doc_title ?? "—"}</span></Field>
        <Field label="Page">{corpusRef.page != null ? `p. ${corpusRef.page}` : "—"}</Field>
        <Field label="Similarité"><span className={`font-semibold ${scoreColor}`}>{pct}%</span></Field>
      </div>
      <div className="h-px bg-border" />
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-1">Extrait :</p>
        <p className="text-xs text-muted-foreground italic leading-relaxed">{corpusRef.excerpt ?? "—"}</p>
      </div>
    </div>
  );
}

function VeilleItemCard({ item, hideRefs }: { item: VeilleItem; hideRefs?: boolean }) {
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [refsOpen, setRefsOpen] = useState(false);

  const href    = item.doi ? `https://doi.org/${item.doi}` : item.url;
  const authors = item.authors ?? [];
  const refs    = (item.corpus_refs ?? []).filter((r): r is CorpusRef => r != null && typeof r === "object");

  return (
    <Card className="p-5 space-y-4">
      {/* Header : titre + score */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{item.source_name ?? "Article"}</p>
          {href
            ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline line-clamp-2 block">{item.title ?? "(titre inconnu)"}</a>
            : <p className="text-sm font-semibold line-clamp-2">{item.title ?? "(titre inconnu)"}</p>
          }
        </div>
        <div className="shrink-0"><ScoreStat score={item.similarity_score} /></div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-1.5">
        {/* Auteurs */}
        <div className="flex gap-2 text-sm">
          <span className="text-muted-foreground shrink-0 w-24">Auteurs :</span>
          <div className="flex-1 min-w-0">
            {authors.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : authorsOpen ? (
              <span>{authors.join(", ")}{" "}
                <button onClick={() => setAuthorsOpen(false)} className="text-xs text-primary underline ml-1">Réduire</button>
              </span>
            ) : (
              <span>{authors.slice(0, 3).join(", ")}{authors.length > 3 && (
                <>{" "}<button onClick={() => setAuthorsOpen(true)} className="text-xs text-primary underline">+{authors.length - 3} auteurs</button></>
              )}</span>
            )}
          </div>
        </div>

        {/* DOI */}
        {item.doi && (
          <Field label="DOI">
            <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">{item.doi}</a>
          </Field>
        )}

        {/* Dans le corpus */}
        {item.document_id && (
          <Field label="Statut">
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Dans le corpus</span>
          </Field>
        )}
      </div>

      {/* Références corpus — masquées si hideRefs (elles seront rendues plus bas) */}
      {!hideRefs && refs.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <button
            onClick={() => setRefsOpen(o => !o)}
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
          >
            <span>{refsOpen ? "▲" : "▼"}</span>
            <span>{refs.length} référence{refs.length > 1 ? "s" : ""} corpus exacte{refs.length > 1 ? "s" : ""}</span>
          </button>
          {refsOpen && (
            <div className="space-y-3">
              {refs.map((ref, i) => <CorpusRefBlock key={i} corpusRef={ref} />)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RefsBlock({ refs }: { refs: CorpusRef[] }) {
  const [open, setOpen] = useState(false);
  if (!refs.length) return null;
  return (
    <div className="space-y-2 border-t pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
      >
        <span>{open ? "▲" : "▼"}</span>
        <span>{refs.length} référence{refs.length > 1 ? "s" : ""} corpus exacte{refs.length > 1 ? "s" : ""}</span>
      </button>
      {open && (
        <div className="space-y-3">
          {refs.map((ref, i) => <CorpusRefBlock key={i} corpusRef={ref} />)}
        </div>
      )}
    </div>
  );
}

// ── Summary parsing + rendering (mirrors /bibliographie) ──────────────────────

type SummaryTheme   = { title: string; description: string }
type SummaryArticle = { item_id: string; contribution: string; relevance: string; corpus_link: string }
type StructuredSummary = { themes: SummaryTheme[]; articles: SummaryArticle[]; synthesis?: string }

function parseSummary(raw: string): StructuredSummary | null {
  try {
    const p = JSON.parse(raw)
    // Accepte { themes, articles } (ancienne pipeline) et { themes, articles, synthesis } (nouvelle)
    if (p && Array.isArray(p.themes) && (Array.isArray(p.articles) || typeof p.synthesis === 'string'))
      return { themes: p.themes ?? [], articles: p.articles ?? [], synthesis: p.synthesis } as StructuredSummary
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

      {/* Synthèse globale (nouvelle pipeline uniquement) */}
      {summary.synthesis && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-5 py-4 space-y-1">
          <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Synthèse du jour</p>
          <p className="text-sm leading-relaxed text-violet-900">{summary.synthesis}</p>
        </div>
      )}

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
          <div className="flex flex-col gap-4">
            {summary.articles.map((article, i) => {
              const item = items.find(it => it.id === article.item_id)
              const refs = (item?.corpus_refs ?? []).filter((r): r is CorpusRef => r != null && typeof r === "object")
              return (
                <div key={i}>
                  {item && <VeilleItemCard item={item} hideRefs />}
                  {/* GPT analysis + refs corpus tout en bas */}
                  <div className="rounded-b-lg border border-t-0 px-5 py-4 space-y-3 bg-muted/20">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contribution scientifique</p>
                      <p className="text-sm leading-relaxed">{article.contribution}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pertinence pour le chercheur</p>
                      <p className="text-sm leading-relaxed">{article.relevance}</p>
                    </div>
                    <div className="space-y-1 bg-blue-50/60 rounded-md p-3 border border-blue-100">
                      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Lien avec le corpus</p>
                      <p className="text-sm leading-relaxed text-blue-900">{article.corpus_link}</p>
                    </div>
                    <RefsBlock refs={refs} />
                  </div>
                </div>
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
  // Ancienne pipeline
  sources: 'Sources RSS',
  urls:    'Enrichissement',
  insert:  'Insertion',
  scoring: 'Scoring',
  summary: 'Résumé IA',
  // Nouvelle pipeline
  filter:               'Filtre articles',
  openalex:             'OpenAlex batch',
  crossref:             'CrossRef',
  extracted:            'Extraits',
  scored:               'Scoring terminé',
  recap_articles:       'Analyse IA',
  recap_articles_done:  'Analyses OK',
  recap_global:         'Résumé global',
  done:    'Terminé',
  fatal:   'Erreur fatale',
}

const LEVEL_STYLES: Record<string, string> = {
  info:  'text-foreground',
  warn:  'text-amber-600',
  error: 'text-red-600 font-medium',
}

const PHASE_BADGE: Record<string, string> = {
  // Ancienne pipeline
  sources: 'bg-blue-100 text-blue-700',
  urls:    'bg-indigo-100 text-indigo-700',
  insert:  'bg-teal-100 text-teal-700',
  scoring: 'bg-purple-100 text-purple-700',
  summary: 'bg-orange-100 text-orange-700',
  // Nouvelle pipeline
  filter:               'bg-sky-100 text-sky-700',
  openalex:             'bg-indigo-100 text-indigo-700',
  crossref:             'bg-cyan-100 text-cyan-700',
  extracted:            'bg-teal-100 text-teal-700',
  scored:               'bg-purple-100 text-purple-700',
  recap_articles:       'bg-amber-100 text-amber-700',
  recap_articles_done:  'bg-amber-100 text-amber-700',
  recap_global:         'bg-orange-100 text-orange-700',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRunDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const day = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${day.charAt(0).toUpperCase() + day.slice(1)} · ${hour}`;
}

// ── Pipeline logs modal ────────────────────────────────────────────────────────

function LogsModal({ logs, onClose }: { logs: RunLogEntry[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold">Logs pipeline</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto p-5">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun log disponible pour cette run.</p>
          ) : (
            <div className="font-mono text-xs space-y-1">
              {logs.map((entry, i) => {
                const time = new Date(entry.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                const badge = PHASE_BADGE[entry.phase] ?? "bg-gray-100 text-gray-700";
                const textStyle = LEVEL_STYLES[entry.level] ?? "text-foreground";
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0 w-16">{time}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>
                      {PHASE_LABELS[entry.phase] ?? entry.phase}
                    </span>
                    <span className={textStyle}>{entry.msg}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const HIGH_SCORE_THRESHOLD = 0.70;

export default function HistoriqueRunPage({ params }: { params: { runId: string } }) {
  const { runId } = params;
  const [items, setItems] = useState<VeilleItem[]>([]);
  const [run, setRun] = useState<VeilleRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);

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

  const highScoreItems = items.filter(it => (it.similarity_score ?? 0) >= HIGH_SCORE_THRESHOLD);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 space-y-6 py-8">

      {/* En-tête */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-3 mb-1">
            <Link href="/bibliographie">← Bibliographie</Link>
          </Button>
          <h1 className="text-xl font-semibold">
            Veille — {loading ? "…" : formatRunDate(run?.started_at)}
          </h1>
        </div>
        {!loading && (run?.pipeline_logs?.length ?? 0) > 0 && (
          <Button variant="outline" size="sm" onClick={() => setLogsOpen(true)}>
            Logs pipeline
          </Button>
        )}
      </div>

      {/* KPIs */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Articles scorés</p>
              <p className="text-3xl font-semibold tabular-nums mt-1">{items.length.toLocaleString("fr-FR")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Articles pertinents <span className="text-xs">(≥ 70%)</span></p>
              <p className="text-3xl font-semibold tabular-nums mt-1 text-green-700">{highScoreItems.length.toLocaleString("fr-FR")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Analysés par IA</p>
              <p className="text-3xl font-semibold tabular-nums mt-1">
                {run?.ai_summary ? (() => {
                  const s = parseSummary(run.ai_summary);
                  return s ? (s.articles.length || run.high_score_count || "—") : "—";
                })() : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Résumé IA */}
      {run?.ai_summary && !loading && (() => {
        const structured = parseSummary(run.ai_summary);
        if (structured) return <StructuredSummaryView summary={structured} run={run} items={items} />;
        return <LegacySummaryView raw={run.ai_summary} run={run} />;
      })()}

      {/* Tableau condensé — articles ≥ 70% */}
      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Tous les articles pertinents{highScoreItems.length > 0 ? ` (${highScoreItems.length})` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {highScoreItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun article au-dessus de 70% pour cette run.</p>
            ) : (
              <div className="rounded border overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left">
                      <th className="px-4 py-2 font-medium text-muted-foreground w-[45%]">Titre</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground w-[35%]">Source</th>
                      <th className="px-4 py-2 font-medium text-muted-foreground text-right w-[20%]">Similarité</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {highScoreItems
                      .sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0))
                      .map((item) => {
                        const pct = Math.round((item.similarity_score ?? 0) * 100);
                        const href = item.doi ? `https://doi.org/${item.doi}` : item.url;
                        return (
                          <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5 max-w-0">
                              <a href={href} target="_blank" rel="noopener noreferrer" className="line-clamp-2 hover:underline text-foreground">
                                {item.title ?? "(titre inconnu)"}
                              </a>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground text-xs">{item.source_name ?? "—"}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="font-semibold tabular-nums text-green-700">{pct}%</span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Modal logs */}
      {logsOpen && (
        <LogsModal logs={run?.pipeline_logs ?? []} onClose={() => setLogsOpen(false)} />
      )}
    </div>
  );
}
