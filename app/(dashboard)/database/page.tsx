"use client";

import { useState, useEffect, useMemo } from "react";
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

type MapPoint = { id: string; x: number; y: number; doc_id: string; doc_title: string | null; year: number | null };
type CleracDoc = { id: string; title: string | null; year: number | null; authors: string[] };
type TimelinePoint = { year: number; count: number };

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
      .slice(0, 3)
      .map(([w]) => w)
      .join(" · ") || "Cluster"
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
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {clusterData.map((cluster, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cluster.color }} />
              <span className="truncate text-muted-foreground capitalize">{cluster.label}</span>
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

function CleracSection({ docs }: { docs: CleracDoc[] }) {
  if (!docs.length) return (
    <p className="text-sm text-muted-foreground">Aucune publication trouvée pour Rodolphe Clérac.</p>
  );
  return (
    <ul className="divide-y divide-border rounded border">
      {docs.map((doc) => (
        <li key={doc.id} className="flex items-start justify-between gap-4 px-4 py-3">
          <span className="text-sm leading-snug line-clamp-2">
            {doc.title ?? <span className="italic text-muted-foreground">Sans titre</span>}
          </span>
          {doc.year && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5">{doc.year}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CorpusMapV2({ points, cleracDocIds }: { points: MapPoint[]; cleracDocIds: Set<string> }) {
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
    }));
  }, [points]);

  const cleracPoints: ClusterPoint[] = useMemo(
    () => points.filter((p) => cleracDocIds.has(p.doc_id)).map((p) => ({
      x: p.x, y: p.y, name: p.doc_title ?? "Sans titre", year: p.year,
    })),
    [points, cleracDocIds]
  );

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
          {cleracPoints.length > 0 && (
            <Scatter
              name="Rodolphe Clérac"
              data={cleracPoints}
              fill="#ff6b00"
              stroke="#fff"
              strokeWidth={1}
              fillOpacity={1}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-4 space-y-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {clusterData?.map((cluster, i) => (
            <div key={i} className="flex items-center gap-2 text-xs min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cluster.color }} />
              <span className="truncate text-muted-foreground capitalize">{cluster.label}</span>
            </div>
          ))}
        </div>
        {cleracPoints.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: "#ff6b00" }} />
            <span className="text-foreground font-medium">Rodolphe Clérac ({cleracPoints.length} chunks)</span>
          </div>
        )}
      </div>
    </div>
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

export default function DatabasePage() {
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [analytics, setAnalytics] = useState<QueryAnalytics | null>(null);
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [cleracDocs, setCleracDocs] = useState<CleracDoc[]>([]);
  const [cleracDocIds, setCleracDocIds] = useState<Set<string>>(new Set());
  const [cleracTotal, setCleracTotal] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resStats, resAnalytics, resMap, resTimeline, resClerac] = await Promise.all([
          fetch("/api/documents/stats"),
          fetch("/api/analytics/overview"),
          fetch("/api/corpus/map"),
          fetch("/api/corpus/timeline"),
          fetch("/api/corpus/clerac"),
        ]);
        if (!cancelled) {
          if (resStats.ok) setStats(await resStats.json());
          if (resAnalytics.ok) setAnalytics(await resAnalytics.json());
          if (resMap.ok) {
            const mapData = await resMap.json();
            setMapPoints(mapData.points ?? []);
          }
          if (resTimeline.ok) {
            const tlData = await resTimeline.json();
            setTimeline(tlData.timeline ?? []);
          }
          if (resClerac.ok) {
            const clData = await resClerac.json();
            setCleracDocs(clData.docs ?? []);
            setCleracDocIds(new Set(clData.docIds ?? []));
            if (clData.openAlexTotal != null) setCleracTotal(clData.openAlexTotal);
          }
        }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [uploadResults]);

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

      {/* Analytics comportement chercheur */}
      <Card>
        <CardHeader>
          <CardTitle>Activité du chercheur — 30 derniers jours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Requêtes totales</p>
              <p className="text-2xl font-semibold tabular-nums">
                {analytics ? analytics.total.toLocaleString("fr-FR") : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Ce mois-ci</p>
              <p className="text-2xl font-semibold tabular-nums">
                {analytics ? analytics.last30Days.toLocaleString("fr-FR") : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hors corpus (garde-fou)</p>
              <p className={`text-2xl font-semibold tabular-nums ${analytics && analytics.guardrailedPct > 30 ? "text-destructive" : ""}`}>
                {analytics ? `${analytics.guardrailedPct}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Requêtes en français</p>
              <p className="text-2xl font-semibold tabular-nums">
                {analytics ? `${analytics.langFrPct}%` : "—"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">Requêtes par jour</p>
            <ActivityChart data={analytics?.dailyStats ?? []} />
          </div>

          {analytics && analytics.topQueries.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Questions les plus fréquentes</p>
              <ul className="space-y-1">
                {analytics.topQueries.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground tabular-nums w-6 shrink-0">{q.count}×</span>
                    <span className="text-foreground line-clamp-1">{q.query_text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analytics && analytics.total === 0 && (
            <p className="text-sm text-muted-foreground">
              Aucune requête encore loggée. Le logging démarre à partir de maintenant.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Carte vectorielle UMAP */}
      <Card>
        <CardHeader>
          <CardTitle>Carte du corpus — espace vectoriel</CardTitle>
        </CardHeader>
        <CardContent>
          <CorpusMap points={mapPoints} />
          {mapPoints.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground text-center">
              {mapPoints.length.toLocaleString("fr-FR")} chunks affichés · {K_CLUSTERS} clusters thématiques détectés automatiquement
            </p>
          )}
        </CardContent>
      </Card>

      {/* Couverture temporelle */}
      <Card>
        <CardHeader>
          <CardTitle>Couverture temporelle du corpus</CardTitle>
        </CardHeader>
        <CardContent>
          <TimelineChart data={timeline} />
          {timeline.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground text-center">
              {timeline.reduce((s, d) => s + d.count, 0).toLocaleString("fr-FR")} documents avec année renseignée · {timeline[0]?.year}–{timeline[timeline.length - 1]?.year}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Publications Clérac */}
      <Card>
        <CardHeader>
          <CardTitle>Publications de Rodolphe Clérac</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {cleracDocs.length} publication{cleracDocs.length !== 1 ? "s" : ""} dans le corpus
            {cleracTotal != null && ` · ${cleracTotal} publications au total sur OpenAlex · couverture ${Math.round((cleracDocs.length / Math.max(cleracTotal, 1)) * 100)}%`}
          </p>
          <CleracSection docs={cleracDocs} />
        </CardContent>
      </Card>

      {/* Carte UMAP v2 — Clérac mis en évidence */}
      <Card>
        <CardHeader>
          <CardTitle>Carte du corpus v2 — publications de Clérac</CardTitle>
        </CardHeader>
        <CardContent>
          <CorpusMapV2 points={mapPoints} cleracDocIds={cleracDocIds} />
          {mapPoints.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground text-center">
              Clusters colorés · points orange = publications de Rodolphe Clérac
            </p>
          )}
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
