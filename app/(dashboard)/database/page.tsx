"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
  BarChart,
  Bar,
  Cell,
} from "recharts";

type UploadResult = {
  filename: string;
  documentId: string;
  status: string;
  chunksCount: number;
  error?: string;
  skipped?: boolean;
};

type AuthorArticleUI = {
  id: string;
  title: string | null;
  journal: string | null;
  year: number | null;
  doi: string | null;
};

type SimilarDocUI = {
  document_id: string;
  title: string | null;
  journal: string | null;
  year: number | null;
  doi: string | null;
  best_similarity: number;
  best_chunk: string | null;
};

type MapPoint = { id: string; x: number; y: number; doc_id: string; doc_title: string | null; year: number | null };
type TimelinePoint = { year: number; count: number };
type JournalStat = { journal: string; count: number };

type QueryAnalytics = {
  total: number;
  last30Days: number;
  guardrailedPct: number;
  langFrPct: number;
  dailyStats: { day: string; total: number; guardrailed: number; lang_fr: number; lang_en: number }[];
  topQueries: { query_text: string; count: number }[];
};

type DocumentStats = {
  docs: { done: number; pending: number; error: number; total: number };
  chunks: { total: number; withEmbedding: number };
  topTerms: { word: string; nentry: number }[];
  errorDocs: { id: string; title: string | null; error_message: string | null; created_at: string }[];
};

const CLUSTER_COLORS = [
  "#3b82f6", "#22c55e", "#ef4444", "#f97316",
  "#a855f7", "#06b6d4", "#ec4899", "#eab308",
];

const K_CLUSTERS = 8;

const STOP_WORDS = new Set([
  "the", "of", "and", "in", "to", "a", "is", "for", "with", "on", "at", "by",
  "from", "that", "this", "are", "was", "as", "be", "it", "an", "or", "not",
  "have", "been", "has", "which", "we", "its", "our", "these", "their", "can",
  "were", "also", "using", "based", "new", "high", "low", "via", "two", "one",
]);

function kmeansCluster(pts: { x: number; y: number }[], k: number): number[] {
  if (pts.length === 0) return [];
  const centroids: { x: number; y: number }[] = [];
  centroids.push({ ...pts[Math.floor(Math.random() * pts.length)] });
  for (let ci = 1; ci < k; ci++) {
    let maxDist = -1, bestIdx = 0;
    for (let pi = 0; pi < pts.length; pi++) {
      let minDist = Infinity;
      for (let j = 0; j < centroids.length; j++) {
        const d = (pts[pi].x - centroids[j].x) ** 2 + (pts[pi].y - centroids[j].y) ** 2;
        if (d < minDist) minDist = d;
      }
      if (minDist > maxDist) { maxDist = minDist; bestIdx = pi; }
    }
    centroids.push({ ...pts[bestIdx] });
  }
  const assignments = new Array(pts.length).fill(0);
  for (let iter = 0; iter < 80; iter++) {
    let changed = false;
    for (let pi = 0; pi < pts.length; pi++) {
      let minDist = Infinity, cluster = 0;
      for (let j = 0; j < k; j++) {
        const d = (pts[pi].x - centroids[j].x) ** 2 + (pts[pi].y - centroids[j].y) ** 2;
        if (d < minDist) { minDist = d; cluster = j; }
      }
      if (assignments[pi] !== cluster) { assignments[pi] = cluster; changed = true; }
    }
    if (!changed) break;
    const sums = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
    for (let pi = 0; pi < pts.length; pi++) {
      sums[assignments[pi]].x += pts[pi].x;
      sums[assignments[pi]].y += pts[pi].y;
      sums[assignments[pi]].n++;
    }
    for (let j = 0; j < k; j++) {
      if (sums[j].n > 0) centroids[j] = { x: sums[j].x / sums[j].n, y: sums[j].y / sums[j].n };
    }
  }
  return assignments;
}

function medianYear(years: number[]): number | null {
  const valid = years.filter((y) => y > 1900);
  if (!valid.length) return null;
  valid.sort((a, b) => a - b);
  return valid[Math.floor(valid.length / 2)];
}

function freshnessInfo(year: number | null): { badge: string; colorClass: string } | null {
  if (year === null) return null;
  if (year >= 2020) return { badge: `${year} · Actif`, colorClass: "text-emerald-600 dark:text-emerald-400" };
  if (year >= 2015) return { badge: `${year} · Récent`, colorClass: "text-yellow-600 dark:text-yellow-400" };
  if (year >= 2010) return { badge: `${year} · Vieillissant`, colorClass: "text-orange-500 dark:text-orange-400" };
  return { badge: `${year} · Ancien`, colorClass: "text-red-600 dark:text-red-400" };
}

function clusterLabel(titles: (string | null)[]): string {
  const freq: Record<string, number> = {};
  for (const title of titles) {
    if (!title) continue;
    for (const w of title.toLowerCase().split(/\W+/)) {
      if (w.length > 3 && !STOP_WORDS.has(w)) freq[w] = (freq[w] ?? 0) + 1;
    }
  }
  return (
    Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(", ") || "Cluster"
  );
}

type ClusterPoint = { x: number; y: number; name: string; year: number | null };

function CorpusMap({ points }: { points: MapPoint[] }) {
  const clusterData = useMemo(() => {
    if (!points.length) return null;
    const assignments = kmeansCluster(points.map((p) => ({ x: p.x, y: p.y })), K_CLUSTERS);
    const groups: { pt: ClusterPoint; title: string | null }[][] = Array.from({ length: K_CLUSTERS }, () => []);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      groups[assignments[i]].push({ pt: { x: p.x, y: p.y, name: p.doc_title ?? "Sans titre", year: p.year }, title: p.doc_title });
    }
    return groups.map((g, i) => ({
      data: g.map((e) => e.pt),
      label: clusterLabel(g.map((e) => e.title)),
      color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
      medYear: medianYear(g.map((e) => e.pt.year).filter((y): y is number => y != null)),
    }));
  }, [points]);

  if (!points.length) return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      <p className="text-sm text-muted-foreground">
        Carte non disponible — lance <code className="bg-muted px-1 rounded text-xs">scripts/compute_umap.py</code> pour calculer les coordonnées.
      </p>
    </div>
  );

  return (
    <div>
      <ResponsiveContainer width="100%" height={440}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <XAxis type="number" dataKey="x" hide domain={["auto", "auto"]} />
          <YAxis type="number" dataKey="y" hide domain={["auto", "auto"]} />
          <ZAxis range={[5, 5]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as ClusterPoint | undefined;
              if (!p) return null;
              return (
                <div className="rounded border bg-background px-3 py-2 text-xs shadow max-w-[220px]">
                  <p className="font-medium line-clamp-2 leading-snug">{p.name}</p>
                  {p.year && <p className="text-muted-foreground mt-1">{p.year}</p>}
                </div>
              );
            }}
          />
          {clusterData?.map((cluster, i) => (
            <Scatter key={i} name={cluster.label} data={cluster.data} fill={cluster.color} fillOpacity={0.55} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
      {clusterData && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
          {clusterData.map((cluster, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: cluster.color }} />
              <div className="min-w-0">
                <p className="text-muted-foreground leading-snug break-words">{cluster.label}</p>
                {freshnessInfo(cluster.medYear) && (
                  <p className={`text-[11px] font-medium ${freshnessInfo(cluster.medYear)!.colorClass}`}>
                    {freshnessInfo(cluster.medYear)!.badge}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityChart({
  data,
}: {
  data: { day: string; total: number }[];
}) {
  if (!data.length) return (
    <p className="text-sm text-muted-foreground py-8 text-center">
      Aucune requête enregistrée sur les 30 derniers jours.
    </p>
  );
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={formatted} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          formatter={(v) => [v, "requêtes"]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
        />
        <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TimelineChart({ data }: { data: TimelinePoint[] }) {
  if (!data.length) return (
    <p className="text-sm text-muted-foreground py-8 text-center">
      Aucune donnée temporelle disponible.
    </p>
  );
  const max = Math.max(...data.map((d) => d.count));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
        <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          formatter={(v) => [v, "documents"]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
        />
        <Bar dataKey="count" radius={[3, 3, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.year}
              fill="hsl(var(--primary))"
              fillOpacity={0.35 + (d.count / max) * 0.65}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function JournalsChart({ data }: { data: JournalStat[] }) {
  if (!data.length) return (
    <p className="text-sm text-muted-foreground py-8 text-center">
      Aucun journal renseigné dans le corpus.
    </p>
  );
  const max = data[0]?.count ?? 1;
  return (
    <ResponsiveContainer width="100%" height={data.length * 32 + 16}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
      >
        <XAxis type="number" hide domain={[0, max]} />
        <YAxis
          type="category"
          dataKey="journal"
          width={180}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => v.length > 28 ? v.slice(0, 27) + "…" : v}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))" }}
          formatter={(v) => [v, "documents"]}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
        />
        <Bar dataKey="count" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={entry.journal}
              fill="hsl(var(--primary))"
              fillOpacity={0.85 - (i / data.length) * 0.5}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function parseErrorMessage(raw: string | null): string {
  if (!raw) return "Erreur inconnue";
  const match = raw.match(/['"]message['"]\s*:\s*['"]([^'"]{4,120})['"]/);
  if (match) return match[1];
  if (raw.includes("504") || raw.includes("Gateway")) return "Gateway timeout (504)";
  return raw.slice(0, 100);
}

function ErrorDocsList({
  docs,
}: {
  docs: { id: string; title: string | null; error_message: string | null; created_at: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? docs : docs.slice(0, 5);

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded border">
        {visible.map((doc) => (
          <li key={doc.id} className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-sm font-medium truncate">
              {doc.title ?? <span className="italic text-muted-foreground">Sans titre</span>}
            </span>
            <span className="text-xs text-destructive truncate">
              {parseErrorMessage(doc.error_message)}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(doc.created_at).toLocaleDateString("fr-FR")}
            </span>
          </li>
        ))}
      </ul>
      {docs.length > 5 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? "Réduire" : `Voir tout (${docs.length} documents)`}
        </button>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  variant = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  variant?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-3xl font-semibold tabular-nums ${
            variant === "warning" ? "text-destructive" : ""
          }`}
        >
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Détecte le texte espacé des vieux PDFs : "K a s u y a – Y o s i d a..."
 * Si > 50% des mots sont des caractères isolés → texte inutilisable à l'affichage.
 */
function isSpacedText(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 8) return false;
  const singleChars = words.filter((w) => w.length <= 1).length;
  return singleChars / words.length > 0.5;
}

function SimilarityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const colorClass =
    pct >= 80 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" :
    pct >= 60 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" :
                "bg-muted text-muted-foreground";
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums shrink-0 ${colorClass}`}>
      {pct}%
    </span>
  );
}

function AuthorArticlesSection() {
  const [articles, setArticles] = useState<AuthorArticleUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [similarMap, setSimilarMap] = useState<Record<string, SimilarDocUI[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    console.log("[AuthorArticlesSection] fetching author articles");
    (async () => {
      try {
        const res = await fetch("/api/corpus/author-articles?pageSize=200");
        if (res.ok) {
          const data = await res.json();
          setArticles(data.articles ?? []);
          setTotal(data.total ?? 0);
          console.log("[AuthorArticlesSection] loaded:", data.total);
        }
      } catch (e) {
        console.error("[AuthorArticlesSection] error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelect = async (id: string) => {
    if (selectedId === id) { setSelectedId(null); return; }
    setSelectedId(id);
    setErrorId(null);
    if (similarMap[id]) return;
    setLoadingId(id);
    console.log("[AuthorArticlesSection] fetching similar for:", id);
    try {
      const res = await fetch(`/api/corpus/author-articles/${id}/similar?limit=10`);
      if (res.ok) {
        const data = await res.json();
        setSimilarMap((prev) => ({ ...prev, [id]: data.results ?? [] }));
        console.log("[AuthorArticlesSection] similar loaded:", data.results?.length ?? 0);
      } else {
        setErrorId(id);
        console.error("[AuthorArticlesSection] similar error:", res.status);
      }
    } catch (e) {
      setErrorId(id);
      console.error("[AuthorArticlesSection] similar fetch error:", e);
    } finally {
      setLoadingId(null);
    }
  };

  // Années disponibles (triées desc)
  const years = useMemo(() => {
    const set = new Set(articles.map((a) => a.year).filter((y): y is number => y !== null));
    return Array.from(set).sort((a, b) => b - a);
  }, [articles]);

  // Articles filtrés
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
      if (yearFilter && a.year !== yearFilter) return false;
      if (q && !(a.title ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [articles, search, yearFilter]);

  if (loading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Chargement des articles…</p>;
  }
  if (!articles.length) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Aucun article auteur indexé. Lancez <code className="bg-muted px-1 rounded text-xs">python3 ingest.py --author</code>.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Barre de recherche + filtre année */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          placeholder="Rechercher par titre…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedId(null); setPage(1); }}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select
          value={yearFilter ?? ""}
          onChange={(e) => { setYearFilter(e.target.value ? parseInt(e.target.value) : null); setSelectedId(null); setPage(1); }}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Toutes les années</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Compteur */}
      {(() => {
        const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
        const safePage = Math.min(page, Math.max(1, totalPages));
        const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

        return (
          <>
            <p className="text-xs text-muted-foreground">
              {filtered.length === total
                ? `${total} articles publiés indexés`
                : `${filtered.length} résultat${filtered.length > 1 ? "s" : ""} sur ${total} articles`}
              {filtered.length > 0 && ` · page ${safePage}/${totalPages}`}
              {" · "}Cliquez pour voir les similaires dans le corpus
            </p>

            {filtered.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Aucun article ne correspond à cette recherche.
              </p>
            )}

            <ul className="divide-y divide-border rounded border">
              {paginated.map((article) => {
          const isOpen = selectedId === article.id;
          const isLoadingThis = loadingId === article.id;
          const similar = similarMap[article.id];
          const hasError = errorId === article.id;

          return (
            <li key={article.id}>
              {/* ── En-tête de l'article auteur ── */}
              <button
                className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex items-start justify-between gap-4"
                onClick={() => handleSelect(article.id)}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-1">
                    {article.title ?? <span className="italic text-muted-foreground">Sans titre</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[article.journal, article.year].filter(Boolean).join(" · ")}
                    {article.doi && (
                      <span className="ml-2 opacity-60">DOI: {article.doi}</span>
                    )}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs shrink-0 mt-0.5 select-none">
                  {isOpen ? "▲" : "▼"}
                </span>
              </button>

              {/* ── Panneau similaires ── */}
              {isOpen && (
                <div className="px-4 pb-4 bg-muted/20 border-t">
                  {isLoadingThis && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Recherche dans le corpus…
                    </p>
                  )}
                  {hasError && !isLoadingThis && (
                    <p className="text-sm text-destructive py-4 text-center">
                      Erreur lors de la recherche. Réessayez dans quelques secondes.
                    </p>
                  )}
                  {!isLoadingThis && !hasError && similar?.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Aucun document suffisamment similaire trouvé dans le corpus (seuil 30%).
                    </p>
                  )}
                  {!isLoadingThis && !hasError && similar && similar.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Documents corpus similaires
                      </p>
                      {similar.map((doc) => (
                        <div
                          key={doc.document_id}
                          className="rounded border bg-background px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium line-clamp-2 leading-snug">
                                {doc.title ?? <span className="italic text-muted-foreground">Sans titre</span>}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[doc.journal, doc.year].filter(Boolean).join(" · ")}
                              </p>
                              {doc.best_chunk && !isSpacedText(doc.best_chunk) && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic leading-relaxed">
                                  &ldquo;{doc.best_chunk.trim()}&rdquo;
                                </p>
                              )}
                            </div>
                            <SimilarityBadge score={doc.best_similarity} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => { setPage((p) => Math.max(1, p - 1)); setSelectedId(null); }}
                  disabled={safePage <= 1}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                >
                  ← Précédent
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {safePage} / {totalPages}
                </span>
                <button
                  onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); setSelectedId(null); }}
                  disabled={safePage >= totalPages}
                  className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                >
                  Suivant →
                </button>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

export default function DatabasePage() {
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [journals, setJournals] = useState<JournalStat[]>([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [loadingJournals, setLoadingJournals] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const journalsRef = useRef<HTMLDivElement>(null);

  // Load KPIs immediately (visible above the fold)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/documents/stats")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled && d) setStats(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [uploadResults]);

  // Lazy-load each chart section when it enters the viewport
  useEffect(() => {
    const makeObserver = (
      ref: React.RefObject<HTMLDivElement | null>,
      setLoading: (v: boolean) => void,
      onLoad: (data: unknown) => void,
      url: string,
    ) => {
      const el = ref.current;
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            obs.disconnect();
            setLoading(true);
            fetch(url)
              .then((r) => r.ok ? r.json() : null)
              .then((d) => { if (d) onLoad(d); })
              .catch(() => {})
              .finally(() => setLoading(false));
          }
        },
        { rootMargin: "200px" },
      );
      obs.observe(el);
      return obs;
    };

    const o1 = makeObserver(journalsRef, setLoadingJournals, (d: unknown) => setJournals((d as { journals: JournalStat[] }).journals ?? []), "/api/corpus/journals");
    const o2 = makeObserver(mapRef, setLoadingMap, (d: unknown) => setMapPoints((d as { points: MapPoint[] }).points ?? []), "/api/corpus/map");
    const o3 = makeObserver(timelineRef, setLoadingTimeline, (d: unknown) => setTimeline((d as { timeline: TimelinePoint[] }).timeline ?? []), "/api/corpus/timeline");

    return () => { o1?.disconnect(); o2?.disconnect(); o3?.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const coveragePct = stats
    ? Math.round((stats.chunks.withEmbedding / Math.max(stats.chunks.total, 1)) * 100)
    : null;

  const errorPct = stats
    ? Math.round((stats.docs.error / Math.max(stats.docs.total, 1)) * 100)
    : null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 space-y-8 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Database</h1>
        <p className="mt-2 text-muted-foreground">
          Vue d&apos;ensemble du corpus : documents indexés, chunks, couverture des embeddings et santé de l&apos;ingestion.
        </p>
      </div>

      {/* Upload */}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="Documents indexés"
          value={stats ? stats.docs.done.toLocaleString("fr-FR") : "—"}
          sub="statut done"
        />
        <KpiCard
          label="Chunks en base"
          value={stats ? stats.chunks.total.toLocaleString("fr-FR") : "—"}
          sub="segments de texte"
        />
        <KpiCard
          label="Couverture embeddings"
          value={coveragePct !== null ? `${coveragePct}%` : "—"}
          sub={stats ? `${stats.chunks.withEmbedding.toLocaleString("fr-FR")} / ${stats.chunks.total.toLocaleString("fr-FR")}` : undefined}
        />
        <KpiCard
          label="Documents en erreur"
          value={stats ? stats.docs.error.toLocaleString("fr-FR") : "—"}
          sub={errorPct !== null ? `${errorPct}% du total` : undefined}
          variant={stats && stats.docs.error > 0 ? "warning" : "default"}
        />
      </div>

      {/* Top journaux */}
      <div ref={journalsRef}>
        <Card>
          <CardHeader>
            <CardTitle>Top journaux du corpus</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingJournals
              ? <div className="h-40 animate-pulse rounded bg-muted" />
              : <>
                  <JournalsChart data={journals} />
                  {journals.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground text-center">
                      {journals.length} journaux distincts affichés · {journals.reduce((s, j) => s + j.count, 0).toLocaleString("fr-FR")} documents avec journal renseigné
                    </p>
                  )}
                </>
            }
          </CardContent>
        </Card>
      </div>

      {/* Carte vectorielle UMAP */}
      <div ref={mapRef}>
        <Card>
          <CardHeader>
            <CardTitle>Carte du corpus — espace vectoriel</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingMap
              ? <div className="h-64 animate-pulse rounded bg-muted" />
              : <>
                  <CorpusMap points={mapPoints} />
                  {mapPoints.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground text-center">
                      {mapPoints.length.toLocaleString("fr-FR")} chunks affichés · {K_CLUSTERS} clusters thématiques détectés automatiquement
                    </p>
                  )}
                </>
            }
          </CardContent>
        </Card>
      </div>

      {/* Couverture temporelle */}
      <div ref={timelineRef}>
        <Card>
          <CardHeader>
            <CardTitle>Couverture temporelle du corpus</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTimeline
              ? <div className="h-40 animate-pulse rounded bg-muted" />
              : <>
                  <TimelineChart data={timeline} />
                  {timeline.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground text-center">
                      {timeline.reduce((s, d) => s + d.count, 0).toLocaleString("fr-FR")} documents avec année renseignée · {timeline[0]?.year}–{timeline[timeline.length - 1]?.year}
                    </p>
                  )}
                </>
            }
          </CardContent>
        </Card>
      </div>

      {/* Articles publiés du chercheur — comparaison corpus */}
      <Card>
        <CardHeader>
          <CardTitle>Articles publiés du chercheur — liens avec le corpus</CardTitle>
        </CardHeader>
        <CardContent>
          <AuthorArticlesSection />
        </CardContent>
      </Card>

      {/* Santé du corpus */}
      {stats && stats.docs.error > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-destructive" />
              Santé du corpus — {stats.docs.error} documents en erreur
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ces documents ont échoué lors de l&apos;ingestion (timeout Supabase). Ils ne sont pas utilisés dans le RAG.
              La correction du pipeline permettra de les réingérer.
            </p>
            <ErrorDocsList docs={stats.errorDocs} />
          </CardContent>
        </Card>
      )}

    </div>
  );
}
