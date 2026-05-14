"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

type UploadResult = {
  filename: string;
  documentId: string;
  status: string;
  chunksCount: number;
  error?: string;
  skipped?: boolean;
};

type MapPoint = { id: string; x: number; y: number; doc_id: string; doc_title: string | null };

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

function CorpusMap({ points }: { points: MapPoint[] }) {
  if (!points.length) return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
      <p className="text-sm text-muted-foreground">
        Carte non disponible — lance <code className="bg-muted px-1 rounded text-xs">scripts/compute_umap.py</code> pour calculer les coordonnées.
      </p>
    </div>
  );

  const data = points.map((p) => ({ x: p.x, y: p.y, name: p.doc_title ?? "Sans titre" }));

  return (
    <ResponsiveContainer width="100%" height={420}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis type="number" dataKey="x" hide domain={["auto", "auto"]} />
        <YAxis type="number" dataKey="y" hide domain={["auto", "auto"]} />
        <ZAxis range={[4, 4]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload;
            if (!p) return null;
            return (
              <div className="rounded border bg-background px-2 py-1 text-xs shadow">
                {p.name}
              </div>
            );
          }}
        />
        <Scatter data={data} fill="hsl(var(--primary))" fillOpacity={0.45} />
      </ScatterChart>
    </ResponsiveContainer>
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

function TermsChart({ terms }: { terms: { word: string; nentry: number }[] }) {
  if (!terms.length) return null;
  const data = terms.slice(0, 15).map((t) => ({ word: t.word, occurrences: t.nentry }));
  const max = Math.max(...data.map((d) => d.occurrences));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 72 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="word"
          tick={{ fontSize: 13 }}
          tickLine={false}
          axisLine={false}
          width={68}
        />
        <Tooltip
          formatter={(v) => [typeof v === "number" ? v.toLocaleString("fr-FR") : v, "occurrences"]}
          cursor={{ fill: "hsl(var(--muted))" }}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))" }}
        />
        <Bar dataKey="occurrences" radius={[0, 4, 4, 0]}>
          {data.map((d) => {
            const ratio = d.occurrences / max;
            const opacity = 0.35 + ratio * 0.65;
            return <Cell key={d.word} fill={`hsl(var(--primary))`} fillOpacity={opacity} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function WordCloud({ terms }: { terms: { word: string; nentry: number }[] }) {
  if (!terms.length) return null;

  const max = Math.max(...terms.map((t) => t.nentry));
  const min = Math.min(...terms.map((t) => t.nentry));
  const range = Math.max(max - min, 1);

  const fontSize = (n: number) => {
    const ratio = (n - min) / range;
    return +(0.85 + ratio * 1.55).toFixed(2);
  };

  const opacity = (n: number) => {
    const ratio = (n - min) / range;
    return +(0.4 + ratio * 0.6).toFixed(2);
  };

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-3 items-center justify-center py-2 px-2">
      {terms.map(({ word, nentry }) => (
        <span
          key={word}
          title={`${nentry.toLocaleString("fr-FR")} occurrences`}
          style={{ fontSize: `${fontSize(nentry)}rem`, opacity: opacity(nentry) }}
          className="font-semibold text-primary cursor-default select-none transition-opacity hover:opacity-100"
        >
          {word}
        </span>
      ))}
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
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[] | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resStats, resAnalytics, resMap] = await Promise.all([
          fetch("/api/documents/stats"),
          fetch("/api/analytics/overview"),
          fetch("/api/corpus/map"),
        ]);
        if (!cancelled) {
          if (resStats.ok) setStats(await resStats.json());
          if (resAnalytics.ok) setAnalytics(await resAnalytics.json());
          if (resMap.ok) {
            const mapData = await resMap.json();
            setMapPoints(mapData.points ?? []);
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
          {/* KPI comportement */}
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

          {/* Courbe d'activité quotidienne */}
          <div>
            <p className="text-sm font-medium mb-3">Requêtes par jour</p>
            <ActivityChart data={analytics?.dailyStats ?? []} />
          </div>

          {/* Top requêtes */}
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

      {/* Word Cloud */}
      {stats && stats.topTerms.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Termes dominants du corpus</CardTitle>
          </CardHeader>
          <CardContent>
            <WordCloud terms={stats.topTerms} />
            <p className="mt-4 text-xs text-muted-foreground text-center">
              {stats.topTerms.length} termes scientifiques — taille proportionnelle à la fréquence dans les chunks
            </p>
          </CardContent>
        </Card>
      )}

      {/* Bar chart top termes */}
      {stats && stats.topTerms.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top 15 termes — fréquence dans le corpus</CardTitle>
          </CardHeader>
          <CardContent>
            <TermsChart terms={stats.topTerms} />
          </CardContent>
        </Card>
      )}

      {/* Carte vectorielle UMAP */}
      <Card>
        <CardHeader>
          <CardTitle>Carte du corpus — espace vectoriel</CardTitle>
        </CardHeader>
        <CardContent>
          <CorpusMap points={mapPoints} />
          {mapPoints.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground text-center">
              {mapPoints.length.toLocaleString("fr-FR")} chunks affichés — chaque point = un segment de texte, les clusters = zones thématiques proches
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
