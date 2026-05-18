"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TabId = "veille" | "historique" | "sources";

// ── Structured summary types (mirrors lib/veille/summarize.ts) ────────────────

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

type CorpusRef = {
  doc_title: string;
  excerpt: string;
  page: number | null;
  similarity: number;
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
  corpus_refs?: CorpusRef[] | null;
};

// ── Source types & components ─────────────────────────────────────────────────

type Source = {
  id: string
  name: string
  publisher: string | null
  issn: string | null
  url: string
  rss_url: string | null
  source_type: "rss" | "openalex"
  active: boolean
  created_at: string
  last_checked_at: string | null
}

function AddSourceDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (s: Source) => void }) {
  const [name, setName]           = useState("");
  const [publisher, setPublisher] = useState("");
  const [issn, setIssn]           = useState("");
  const [url, setUrl]             = useState("");
  const [rssUrl, setRssUrl]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  function reset() { setName(""); setPublisher(""); setIssn(""); setUrl(""); setRssUrl(""); setError(null); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) { setError("Nom et URL sont obligatoires."); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/veille/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), publisher: publisher.trim() || null, issn: issn.trim() || null, url: url.trim(), rss_url: rssUrl.trim() || null }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Erreur serveur"); return; }
      const { source } = await res.json();
      onAdded(source);
      reset();
      onClose();
    } catch { setError("Erreur réseau"); }
    finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter une source</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nom du journal *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Journal of the American Chemical Society" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Éditeur</Label>
            <Input value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="ACS" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">ISSN</Label>
            <Input value={issn} onChange={e => setIssn(e.target.value)} placeholder="0002-7863" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL du journal *</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://pubs.acs.org/journal/jacsat" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">URL RSS <span className="text-muted-foreground/60">(vide → OpenAlex)</span></Label>
            <Input value={rssUrl} onChange={e => setRssUrl(e.target.value)} placeholder="https://pubs.acs.org/action/showFeed?..." />
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex justify-end gap-2 mt-1">
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}>Annuler</Button>
            <Button type="submit" disabled={loading}>{loading ? "Ajout…" : "Ajouter"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SourceRow({ source, onToggle }: { source: Source; onToggle: (id: string, active: boolean) => void }) {
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    onToggle(source.id, !source.active);
    try {
      await fetch(`/api/veille/sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !source.active }),
      });
    } finally { setLoading(false); }
  }

  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-lg transition-opacity ${source.active ? "opacity-100" : "opacity-50"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${source.active ? "bg-green-500" : "bg-muted-foreground/30"}`} />
        <a
          href={source.rss_url ?? source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm truncate hover:underline"
        >
          {source.name}
        </a>
        <span className="text-xs text-muted-foreground shrink-0">{source.source_type.toUpperCase()}</span>
        {source.issn && <span className="text-xs text-muted-foreground/50 shrink-0 font-mono">{source.issn}</span>}
        {!source.active && <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">Désactivée</span>}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        disabled={loading}
        className={`shrink-0 text-xs h-7 px-2.5 ${source.active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
      >
        {source.active ? "Désactiver" : "Activer"}
      </Button>
    </div>
  );
}

const PHASE_LABELS: Record<string, string> = {
  sources: "Récupération RSS",
  urls:    "Enrichissement OpenAlex",
  items:   "Scoring des articles",
  summary: "Résumé IA",
  done:    "Terminé",
};

const PHASES = ["sources", "urls", "items", "summary"] as const;

// Plages de progression globale par phase (0-100)
const PHASE_PROGRESS: Record<string, [number, number]> = {
  pending:  [0,   0],
  sources:  [0,  15],
  urls:     [15, 35],
  items:    [35, 85],
  summary:  [85, 95],
  done:     [100, 100],
};

function globalProgress(
  phase: string | null,
  itemsProcessed: number | null,
  itemsTotal: number | null
): number {
  if (!phase || phase === "pending") return 0;
  if (phase === "done") return 100;
  const range = PHASE_PROGRESS[phase];
  if (!range) return 0;
  const [start, end] = range;
  if (phase === "items" && itemsTotal && itemsTotal > 0) {
    const ratio = Math.min(1, (itemsProcessed ?? 0) / itemsTotal);
    return Math.round(start + ratio * (end - start));
  }
  // Pour les autres phases, on affiche le milieu de la plage
  return Math.round((start + end) / 2);
}

const DEFAULT_THRESHOLD = 0.30;

function ScoreStat({ score }: { score: number | null }) {
  if (score == null) return (
    <div className="flex flex-col items-center justify-center rounded-lg px-3 py-2 bg-muted min-w-[68px]">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Similarité</span>
      <span className="text-lg font-bold text-muted-foreground">—</span>
    </div>
  );
  const pct = Math.round(score * 100);
  const colors = pct >= 70
    ? "bg-green-100 text-green-800"
    : pct >= 50
    ? "bg-yellow-100 text-yellow-800"
    : "bg-muted text-muted-foreground";
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

// ── Summary rendering ─────────────────────────────────────────────────────────

const THEME_COLORS = [
  "bg-blue-50 border-blue-200 text-blue-900",
  "bg-violet-50 border-violet-200 text-violet-900",
  "bg-teal-50 border-teal-200 text-teal-900",
];

function CorpusRefBlock({ corpusRef }: { corpusRef: CorpusRef }) {
  const docTitle  = String(corpusRef?.doc_title  ?? "—");
  const excerpt   = String(corpusRef?.excerpt    ?? "—");
  const page      = corpusRef?.page != null ? `p. ${corpusRef.page}` : "—";
  const simRaw    = Number(corpusRef?.similarity ?? 0);
  const pct       = Math.round(simRaw * 100);
  const scoreColor = pct >= 70 ? "text-green-700" : pct >= 50 ? "text-yellow-700" : "text-muted-foreground";

  return (
    <div className="bg-muted/50 rounded-md p-3 space-y-2 border border-border">
      <div className="space-y-1">
        <Field label="Document"><span className="font-medium">{docTitle}</span></Field>
        <Field label="Page">{page}</Field>
        <Field label="Similarité">
          <span className={`font-semibold ${scoreColor}`}>{pct}%</span>
        </Field>
      </div>
      <div className="h-px bg-border" />
      <div>
        <p className="text-xs text-muted-foreground font-medium mb-1">Extrait :</p>
        <p className="text-xs text-muted-foreground italic leading-relaxed">{excerpt}</p>
      </div>
    </div>
  );
}

function SummaryArticleCard({ article, item }: { article: SummaryArticle; item: VeilleItem | undefined }) {
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [refsOpen, setRefsOpen]       = useState(false);

  const href    = item?.doi ? `https://doi.org/${item.doi}` : item?.url ?? null;
  const authors = item?.authors ?? [];
  const refs    = (item?.corpus_refs ?? []).filter((r): r is CorpusRef => r != null && typeof r === "object");
  const title   = item?.title ?? "(titre inconnu)";
  const source  = item?.source_name ?? "—";

  return (
    <Card className="p-5 space-y-4">

      {/* Header : titre + score */}
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Article</p>
          {href
            ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline line-clamp-2 block">{title}</a>
            : <p className="text-sm font-semibold line-clamp-2">{title}</p>
          }
          <p className="text-xs text-muted-foreground mt-0.5">{source}</p>
        </div>
        <div className="shrink-0"><ScoreStat score={item?.similarity_score ?? null} /></div>
      </div>

      <div className="h-px bg-border" />

      {/* Données factuelles DB */}
      <div className="space-y-1.5">

        {/* Auteurs dépliables */}
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
        {item?.doi && (
          <Field label="DOI">
            <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">
              {item.doi}
            </a>
          </Field>
        )}

        {/* Dans le corpus */}
        {item?.document_id && (
          <Field label="Statut">
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Dans le corpus</span>
          </Field>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Analyse GPT */}
      <div className="space-y-3">
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
      </div>

      {/* Références corpus DB */}
      {refs.length > 0 && (
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

function StructuredSummaryView({
  summary,
  run,
  items,
}: {
  summary: StructuredSummary
  run: VeilleRun
  items: VeilleItem[]
}) {
  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Résumé de la veille</h2>
        <span className="text-sm text-muted-foreground">
          {run.high_score_count ?? 0} articles pertinents
          {run.score_threshold != null && ` (score ≥ ${Math.round(run.score_threshold * 100)}%)`}
        </span>
      </div>

      {/* Thèmes */}
      {summary.themes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Thèmes émergents lors de la veille</p>
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

      {/* Articles analysés */}
      {summary.articles.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Articles analysés ({summary.articles.length})
          </p>
          <div className="flex flex-col gap-4">
            {summary.articles.map((article, i) => (
              <SummaryArticleCard key={i} article={article} item={items.find(it => it.id === article.item_id)} />
            ))}
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
          <span>Résumé de la semaine</span>
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

export default function BibliographiePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<TabId>("veille");

  // Sources state
  const [sources, setSources]               = useState<Source[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [sourcesError, setSourcesError]     = useState<string | null>(null);
  const [filterPublisher, setFilterPublisher] = useState("all");
  const [activeOnly, setActiveOnly]         = useState(false);
  const [dialogOpen, setDialogOpen]         = useState(false);
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

  const fetchSources = useCallback(async () => {
    setLoadingSources(true);
    setSourcesError(null);
    try {
      const res = await fetch("/api/veille/sources");
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      setSources(d.sources ?? []);
    } catch { setSourcesError("Impossible de charger les sources."); }
    finally { setLoadingSources(false); }
  }, []);

  const publishers = useMemo(() => {
    const set = new Set(sources.map(s => s.publisher ?? "Autre"));
    return ["all", ...Array.from(set).sort()];
  }, [sources]);

  const filteredSources = useMemo(() => {
    return sources.filter(s => {
      if (activeOnly && !s.active) return false;
      if (filterPublisher !== "all" && (s.publisher ?? "Autre") !== filterPublisher) return false;
      return true;
    });
  }, [sources, activeOnly, filterPublisher]);

  const groupedSources = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of filteredSources) {
      const key = s.publisher ?? "Autre";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredSources]);

  const totalActive = sources.filter(s => s.active).length;

  function handleToggleSource(id: string, active: boolean) {
    setSources(prev => prev.map(s => s.id === id ? { ...s, active } : s));
  }

  function handleSourceAdded(source: Source) {
    setSources(prev => [...prev, source]);
  }

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
      const params = new URLSearchParams({ limit: "50" });
      if (runIdFilter) params.set("runId", runIdFilter);
      if (minScore !== undefined) params.set("minScore", String(minScore));
      const res = await fetch(`/api/veille/items?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const raw = await res.json();
      setItems(Array.isArray(raw) ? raw : []);
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

  // Load sources when tab is selected
  useEffect(() => {
    if (tab === "sources" && sources.length === 0) {
      fetchSources();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
        <Button variant={tab === "veille" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab("veille")}>
          Veille
        </Button>
        <Button variant={tab === "historique" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab("historique")}>
          Historique
        </Button>
        <Button variant={tab === "sources" ? "secondary" : "ghost"} size="sm" className="flex-1" onClick={() => setTab("sources")}>
          Sources
        </Button>
      </div>

      {/* ── Tab : Veille ── */}
      {tab === "veille" && (
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
                    <div className="space-y-3">
                      {/* Pills phases */}
                      <div className="flex flex-wrap gap-2">
                        {PHASES.map((p) => {
                          const idx = PHASES.indexOf(p);
                          const currentIdx = runPhase ? PHASES.indexOf(runPhase as typeof PHASES[number]) : -1;
                          const done = idx < currentIdx || runPhase === "done";
                          const current = runPhase === p;
                          return (
                            <span key={p} className={`rounded px-2 py-0.5 text-xs flex items-center gap-1 ${current ? "bg-primary text-primary-foreground" : done ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"}`}>
                              {done && <span>✓</span>}
                              {current && runPhase === "summary" && (
                                <span className="inline-block h-2 w-2 rounded-full bg-primary-foreground/70 animate-pulse" />
                              )}
                              {PHASE_LABELS[p]}
                            </span>
                          );
                        })}
                      </div>

                      {/* Barre de progression globale */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>
                            {runPhase === "summary"
                              ? "Génération du résumé IA…"
                              : runPhase === "items" && runItemsTotal
                              ? `${runItemsProcessed ?? 0} / ${runItemsTotal} articles scorés`
                              : runPhase ? PHASE_LABELS[runPhase] : "Démarrage…"}
                          </span>
                          <span className="font-medium tabular-nums">
                            {globalProgress(runPhase, runItemsProcessed, runItemsTotal)}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all duration-500 ${runPhase === "summary" ? "bg-primary animate-pulse" : "bg-primary"}`}
                            style={{ width: `${globalProgress(runPhase, runItemsProcessed, runItemsTotal)}%` }}
                          />
                        </div>
                      </div>

                      {/* Message spécifique pendant le résumé IA */}
                      {runPhase === "summary" && (
                        <p className="text-xs text-muted-foreground italic">
                          GPT analyse les articles les plus pertinents pour générer le résumé de la semaine…
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sélecteur de seuil de similarité */}
          {currentRun && !isRunning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Seuil de pertinence :</span>
              <select
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                className="border border-border bg-background text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value={0.20}>≥ 20%</option>
                <option value={0.25}>≥ 25%</option>
                <option value={0.30}>≥ 30%</option>
                <option value={0.40}>≥ 40%</option>
                <option value={0.50}>≥ 50%</option>
                <option value={0.70}>≥ 70%</option>
              </select>
              <span className="text-xs">({items.length} articles affichés)</span>
            </div>
          )}

          {/* Résumé IA — structuré (nouveau) ou texte brut (legacy) */}
          {currentRun?.ai_summary && !isRunning && (() => {
            const structured = parseSummary(currentRun.ai_summary)
            if (structured) {
              return <StructuredSummaryView summary={structured} run={currentRun} items={items} />
            }
            return <LegacySummaryView raw={currentRun.ai_summary} run={currentRun} />
          })()}

        </div>
      )}

      {/* ── Tab : Sources ── */}
      {tab === "sources" && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-semibold">Sources de veille</h2>
              <p className="text-sm text-muted-foreground mt-0.5">{sources.length} sources — {totalActive} actives</p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>+ Ajouter une source</Button>
          </div>

          {/* Filtres */}
          <div className="flex items-center gap-4 flex-wrap">
            <select
              value={filterPublisher}
              onChange={e => setFilterPublisher(e.target.value)}
              className="border border-border bg-background text-sm rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {publishers.map(p => (
                <option key={p} value={p}>{p === "all" ? "Tous les éditeurs" : p}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="rounded" />
              Actives seulement
            </label>
          </div>

          {/* Liste */}
          <Card>
            <CardContent className="pt-4">
              {loadingSources && <p className="text-sm text-muted-foreground py-4">Chargement…</p>}
              {sourcesError && <p className="text-sm text-destructive py-4">{sourcesError}</p>}
              {!loadingSources && !sourcesError && groupedSources.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">Aucune source trouvée.</p>
              )}
              {groupedSources.map(([publisher, srcs]) => (
                <div key={publisher} className="mb-5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1 px-3">{publisher}</p>
                  <div className="flex flex-col gap-0.5">
                    {srcs.map(s => (
                      <SourceRow key={s.id} source={s} onToggle={handleToggleSource} />
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <AddSourceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdded={handleSourceAdded} />
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
