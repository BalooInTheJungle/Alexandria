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

export default function HistoriqueRunPage({ params }: { params: { runId: string } }) {
  const { runId } = params;
  const [items, setItems] = useState<VeilleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [runStatus, setRunStatus] = useState<string | null>(null);

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
          const run = await runRes.json();
          setRunStatus(run.status);
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  const scoreFinal = (item: VeilleItem) => {
    const h = item.heuristic_score ?? 0;
    const v = item.similarity_score ?? 0;
    return (h + v) / 2;
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 space-y-6 py-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/bibliographie">← Bibliographie</Link>
        </Button>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Run {runId.slice(0, 8)}…</CardTitle>
          {runStatus && (
            <span className="text-sm font-medium text-muted-foreground">Statut : {runStatus}</span>
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
