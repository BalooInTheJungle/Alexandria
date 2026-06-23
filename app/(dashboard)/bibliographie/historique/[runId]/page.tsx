"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// ── Types ──────────────────────────────────────────────────────────────────────

type RunLogEntry = {
  ts:    string
  level: "info" | "warn" | "error"
  phase: string
  msg:   string
}

type CorpusRef = {
  doc_title: string | null
  excerpt:   string | null
  page:      number | null
  similarity: number
}

type AiAnalysis = {
  contribution: string
  relevance:    string
  corpus_link:  string
}

type VeilleRun = {
  id:               string
  status:           string
  started_at:       string | null
  completed_at:     string | null
  error_message:    string | null
  ai_summary:       string | null
  high_score_count: number | null
  score_threshold:  number | null
  pipeline_logs:    RunLogEntry[] | null
}

type VeilleItem = {
  id:               string
  url:              string
  title:            string | null
  authors:          string[] | null
  doi:              string | null
  abstract:         string | null
  similarity_score: number | null
  author_score:     number | null
  source_name:      string | null
  document_id:      string | null
  corpus_refs:      CorpusRef[] | null
  read_at:          string | null
  ai_analysis:      AiAnalysis | null
}

type SummaryTheme   = { title: string; description: string }
type SummaryArticle = { item_id: string; contribution: string; relevance: string; corpus_link: string }
type StructuredSummary = { themes: SummaryTheme[]; articles: SummaryArticle[]; synthesis?: string }

// ── Parsing ────────────────────────────────────────────────────────────────────

function parseSummary(raw: string): StructuredSummary | null {
  try {
    const p = JSON.parse(raw)
    if (p && Array.isArray(p.themes) && (Array.isArray(p.articles) || typeof p.synthesis === "string"))
      return { themes: p.themes ?? [], articles: p.articles ?? [], synthesis: p.synthesis }
    return null
  } catch { return null }
}

// ── Logs modal ─────────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<string, string> = {
  dedup: "Dédup DOI", sources: "Sources RSS", filter: "Filtre",
  openalex: "OpenAlex", crossref: "CrossRef", insert: "Insertion",
  extracted: "Extraits", load: "Chargement", corpus: "Termes corpus",
  scoring: "Scoring", save: "Sauvegarde", scored: "Scoring OK",
  recap_articles: "Analyse IA", recap_articles_done: "Analyses OK",
  recap_global: "Résumé global", parse: "Parse JSON",
  gpt: "GPT", done: "Terminé", fatal: "Erreur fatale",
}

const PHASE_BADGE: Record<string, string> = {
  dedup: "bg-slate-100 text-slate-700",
  sources: "bg-blue-100 text-blue-700",
  filter: "bg-sky-100 text-sky-700",
  openalex: "bg-indigo-100 text-indigo-700",
  crossref: "bg-cyan-100 text-cyan-700",
  insert: "bg-teal-100 text-teal-700",
  extracted: "bg-teal-100 text-teal-700",
  load: "bg-gray-100 text-gray-700",
  corpus: "bg-gray-100 text-gray-700",
  scoring: "bg-purple-100 text-purple-700",
  save: "bg-gray-100 text-gray-700",
  scored: "bg-purple-100 text-purple-700",
  recap_articles: "bg-amber-100 text-amber-700",
  recap_articles_done: "bg-amber-100 text-amber-700",
  recap_global: "bg-orange-100 text-orange-700",
  parse: "bg-orange-100 text-orange-700",
  gpt: "bg-orange-100 text-orange-700",
  done: "bg-green-100 text-green-700",
  fatal: "bg-red-100 text-red-700",
}

const LEVEL_STYLES: Record<string, string> = {
  info: "text-foreground",
  warn: "text-amber-600",
  error: "text-red-600 font-medium",
}

function LogsModal({ logs, onClose }: { logs: RunLogEntry[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-base font-semibold">Logs pipeline</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun log disponible pour cette run.</p>
          ) : (
            <div className="font-mono text-xs space-y-1.5">
              {logs.map((entry, i) => {
                const time = new Date(entry.ts).toLocaleTimeString("fr-FR", {
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                });
                const badge = PHASE_BADGE[entry.phase] ?? "bg-gray-100 text-gray-700";
                const textStyle = LEVEL_STYLES[entry.level] ?? "text-foreground";
                return (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0 w-16">{time}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge}`}>
                      {PHASE_LABELS[entry.phase] ?? entry.phase}
                    </span>
                    <span className={`flex-1 min-w-0 break-words ${textStyle}`}>{entry.msg}</span>
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

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const pct = Math.round(score * 100);
  const cls = pct >= 80 ? "bg-green-100 text-green-800"
    : pct >= 75 ? "bg-emerald-100 text-emerald-800"
    : pct >= 60 ? "bg-yellow-100 text-yellow-800"
    : "bg-muted text-muted-foreground";
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg px-3 py-2 min-w-[68px] shrink-0 ${cls}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Similarité</span>
      <span className="text-xl font-bold tabular-nums leading-tight">{pct}%</span>
    </div>
  );
}

function CorpusRefBlock({ corpusRef: r }: { corpusRef: CorpusRef }) {
  const pct = Math.round((r.similarity ?? 0) * 100);
  const cls = pct >= 70 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-muted-foreground";
  return (
    <div className="bg-muted/50 rounded-md p-3 space-y-2 border border-border text-xs">
      <div className="flex gap-2">
        <span className="text-muted-foreground shrink-0 w-20">Document :</span>
        <span className="font-medium">{r.doc_title ?? "—"}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-muted-foreground shrink-0 w-20">Page :</span>
        <span>{r.page != null ? `p. ${r.page}` : "—"}</span>
      </div>
      <div className="flex gap-2">
        <span className="text-muted-foreground shrink-0 w-20">Similarité :</span>
        <span className={`font-semibold ${cls}`}>{pct}%</span>
      </div>
      {r.excerpt && (
        <>
          <div className="h-px bg-border" />
          <p className="text-muted-foreground italic leading-relaxed">{r.excerpt}</p>
        </>
      )}
    </div>
  );
}

function ArticleCard({
  item,
  onToggleRead,
}: {
  item: VeilleItem
  onToggleRead: (id: string, read: boolean) => void
}) {
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [refsOpen, setRefsOpen]       = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [toggling, setToggling]       = useState(false);

  const href    = item.doi ? `https://doi.org/${item.doi}` : item.url;
  const authors = item.authors ?? [];
  const refs    = (item.corpus_refs ?? []).filter((r): r is CorpusRef => r != null && typeof r === "object");
  const isRead  = !!item.read_at;

  async function handleReadToggle() {
    setToggling(true);
    try {
      const res = await fetch(`/api/veille/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: !isRead }),
      });
      if (res.ok) onToggleRead(item.id, !isRead);
    } finally {
      setToggling(false);
    }
  }

  return (
    <Card className={`p-5 space-y-4 transition-opacity ${isRead ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{item.source_name ?? "Article"}</p>
          {href
            ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline line-clamp-2 block">{item.title ?? "(titre inconnu)"}</a>
            : <p className="text-sm font-semibold line-clamp-2">{item.title ?? "(titre inconnu)"}</p>
          }
        </div>
        <div className="flex flex-col items-center gap-2 shrink-0">
          <ScoreBadge score={item.similarity_score} />
          {item.author_score !== null && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-800">
              <span className="opacity-70">auteur</span> {Math.round(item.author_score * 100)}%
            </span>
          )}
          <button
            onClick={handleReadToggle}
            disabled={toggling}
            className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-40 ${
              isRead
                ? "border-muted-foreground/30 text-muted-foreground hover:border-foreground hover:text-foreground"
                : "border-primary/30 text-primary hover:bg-primary/5"
            }`}
          >
            {isRead ? "✓ Lu" : "Marquer comme lu"}
          </button>
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* Meta */}
      <div className="space-y-1.5 text-sm">
        <div className="flex gap-2">
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
        {item.doi && (
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0 w-24">DOI :</span>
            <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">{item.doi}</a>
          </div>
        )}
        {item.document_id && (
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0 w-24">Statut :</span>
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Dans le corpus</span>
          </div>
        )}
      </div>

      {/* AI analysis */}
      {item.ai_analysis && (
        <div className="border-t pt-3">
          <button
            onClick={() => setAnalysisOpen(o => !o)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-600 hover:text-violet-800 transition-colors"
          >
            <span>{analysisOpen ? "▲" : "▼"}</span>
            <span>✦ Analyse IA</span>
          </button>
          {analysisOpen && (
            <div className="mt-3 space-y-2 rounded-lg bg-violet-50 border border-violet-100 p-4">
              <div>
                <p className="text-xs font-semibold text-violet-700 mb-1">Contribution scientifique</p>
                <p className="text-sm text-violet-900 leading-relaxed">{item.ai_analysis.contribution}</p>
              </div>
              <div className="border-t border-violet-100 pt-2">
                <p className="text-xs font-semibold text-violet-700 mb-1">Pertinence pour le chercheur</p>
                <p className="text-sm text-violet-900 leading-relaxed">{item.ai_analysis.relevance}</p>
              </div>
              <div className="border-t border-violet-100 pt-2">
                <p className="text-xs font-semibold text-blue-700 mb-1">Lien avec le corpus</p>
                <p className="text-sm text-blue-800 leading-relaxed">{item.ai_analysis.corpus_link}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Corpus refs */}
      {refs.length > 0 && (
        <div className="border-t pt-3 space-y-2">
          <button
            onClick={() => setRefsOpen(o => !o)}
            className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
          >
            <span>{refsOpen ? "▲" : "▼"}</span>
            <span>{refs.length} référence{refs.length > 1 ? "s" : ""} corpus exacte{refs.length > 1 ? "s" : ""}</span>
          </button>
          {refsOpen && (
            <div className="space-y-3">
              {refs.map((r, i) => <CorpusRefBlock key={i} corpusRef={r} />)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Theme cards ────────────────────────────────────────────────────────────────

const THEME_COLORS = [
  "bg-blue-50 border-blue-200 text-blue-900",
  "bg-violet-50 border-violet-200 text-violet-900",
  "bg-teal-50 border-teal-200 text-teal-900",
  "bg-amber-50 border-amber-200 text-amber-900",
];

// ── Page ───────────────────────────────────────────────────────────────────────

const SCORE_THRESHOLD = 0.80;

export default function HistoriqueRunPage({ params }: { params: { runId: string } }) {
  const { runId } = params;

  const [run, setRun]       = useState<VeilleRun | null>(null);
  const [items, setItems]   = useState<VeilleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [runRes, itemsRes] = await Promise.all([
          fetch(`/api/veille/runs/${runId}`),
          fetch(`/api/veille/items?runId=${encodeURIComponent(runId)}&limit=200`),
        ]);
        if (!cancelled && runRes.ok)   setRun(await runRes.json());
        if (!cancelled && itemsRes.ok) {
          const data = await itemsRes.json();
          const sorted = (Array.isArray(data) ? data : [])
            .sort((a: VeilleItem, b: VeilleItem) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
          setItems(sorted);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  const handleToggleRead = useCallback((id: string, read: boolean) => {
    setItems(prev => prev.map(it =>
      it.id === id ? { ...it, read_at: read ? new Date().toISOString() : null } : it
    ));
  }, []);

  const pertinentItems  = items.filter(it => (it.similarity_score ?? 0) >= SCORE_THRESHOLD);
  const aiAnalysedItems = items.filter(it => it.ai_analysis != null);
  const summary         = run?.ai_summary ? parseSummary(run.ai_summary) : null;
  const logs            = run?.pipeline_logs ?? [];

  const startedAt = run?.started_at
    ? new Date(run.started_at).toLocaleString("fr-FR", {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 space-y-6 py-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-3 mb-1">
            <Link href="/bibliographie">← Bibliographie</Link>
          </Button>
          <h1 className="text-xl font-semibold capitalize">
            {loading ? "Chargement…" : startedAt ?? "Run"}
          </h1>
          {run && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              run.status === "completed" ? "bg-green-100 text-green-700" :
              run.status === "running"   ? "bg-blue-100 text-blue-700" :
              run.status === "failed"    ? "bg-red-100 text-red-700" :
              "bg-gray-100 text-gray-600"
            }`}>
              {run.status === "completed" ? "Terminé" :
               run.status === "running"   ? "En cours" :
               run.status === "failed"    ? "Échec" : run.status}
            </span>
          )}
        </div>
        {logs.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setLogsOpen(true)}>
            Logs pipeline ({logs.length})
          </Button>
        )}
      </div>

      {/* KPIs */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Articles extraits</p>
              <p className="text-3xl font-semibold tabular-nums mt-1">{items.length > 0 ? items.length : "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Pertinents <span className="text-xs">(≥ 80%)</span></p>
              <p className="text-3xl font-semibold tabular-nums mt-1 text-green-700">
                {pertinentItems.length > 0 ? pertinentItems.length : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm text-muted-foreground">Analysés par IA</p>
              <p className="text-3xl font-semibold tabular-nums mt-1 text-violet-700">
                {aiAnalysedItems.length > 0 ? aiAnalysedItems.length : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Synthèse globale */}
      {!loading && summary?.synthesis && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-5 py-4 space-y-1">
          <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Synthèse du jour</p>
          <p className="text-sm leading-relaxed text-violet-900">{summary.synthesis}</p>
        </div>
      )}

      {/* Thèmes émergents */}
      {!loading && summary && summary.themes.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Thèmes émergents</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.themes.map((theme, i) => (
              <div key={i} className={`rounded-lg border p-4 space-y-1 ${THEME_COLORS[i % THEME_COLORS.length]}`}>
                <p className="text-sm font-semibold">{theme.title}</p>
                <p className="text-xs leading-relaxed opacity-80">{theme.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Articles pertinents */}
      {!loading && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Articles pertinents ≥ 80%{pertinentItems.length > 0 ? ` (${pertinentItems.length})` : ""}
          </p>
          {pertinentItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun article au-dessus de 80% pour cette run.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {pertinentItems.map(item => (
                <ArticleCard key={item.id} item={item} onToggleRead={handleToggleRead} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Logs modal */}
      {logsOpen && <LogsModal logs={logs} onClose={() => setLogsOpen(false)} />}
    </div>
  );
}
