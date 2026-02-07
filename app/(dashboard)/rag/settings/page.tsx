"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type RagSettings = {
  context_turns: number;
  similarity_threshold: number;
  guard_message: string;
  match_count: number;
  match_threshold: number;
  fts_weight: number;
  vector_weight: number;
  rrf_k: number;
  hybrid_top_k: number;
};

const LABELS: Record<keyof RagSettings, string> = {
  context_turns: "Tours de contexte (paires user+assistant envoyées au LLM)",
  similarity_threshold: "Seuil garde-fou (en dessous : message hors domaine, pas d'appel LLM)",
  guard_message: "Message affiché quand la requête est hors domaine",
  match_count: "Nombre max de chunks (recherche vectorielle)",
  match_threshold: "Seuil minimal de similarité pour inclure un chunk",
  fts_weight: "Poids FTS dans la fusion RRF",
  vector_weight: "Poids vectoriel dans la fusion RRF",
  rrf_k: "Paramètre k de la formule RRF",
  hybrid_top_k: "Nombre de chunks après fusion (envoyés au LLM)",
};

export default function RagSettingsPage() {
  const [settings, setSettings] = useState<RagSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<RagSettings>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/rag/settings", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? `Erreur ${res.status}`);
          return;
        }
        if (!cancelled) {
          setSettings(data as RagSettings);
          setForm(data);
        }
      } catch (e) {
        if (!cancelled) setError("Erreur réseau");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/rag/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        return;
      }
      setSettings(data as RagSettings);
      setForm(data);
    } catch (e) {
      setError("Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="p-4">
        <p className="text-muted-foreground">Chargement…</p>
      </main>
    );
  }

  if (error && !settings) {
    return (
      <main className="p-4">
        <p className="text-destructive">{error}</p>
        <Button variant="link" asChild className="mt-2 p-0">
          <Link href="/rag">Retour RAG</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-4">
        <Button variant="link" asChild className="p-0">
          <Link href="/rag">← RAG</Link>
        </Button>
        <h1 className="text-xl font-semibold">Paramètres RAG</h1>
      </div>
      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-muted-foreground">Configuration du pipeline RAG</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {(Object.keys(LABELS) as (keyof RagSettings)[]).map((key) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{LABELS[key]}</Label>
                {key === "guard_message" ? (
                  <Textarea
                    id={key}
                    value={String(form[key] ?? "")}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    rows={3}
                    className="w-full"
                  />
                ) : (
                  <Input
                    id={key}
                    type="number"
                    step={key === "similarity_threshold" || key === "match_threshold" || key === "fts_weight" || key === "vector_weight" ? 0.1 : 1}
                    min={key === "context_turns" ? 1 : key === "similarity_threshold" ? 0.1 : key === "match_count" ? 5 : key === "match_threshold" ? 0 : key === "rrf_k" ? 1 : key === "hybrid_top_k" ? 5 : 0}
                    max={key === "context_turns" ? 10 : key === "similarity_threshold" ? 0.9 : key === "match_count" ? 100 : key === "match_threshold" ? 1 : key === "fts_weight" || key === "vector_weight" ? 10 : key === "rrf_k" ? 200 : key === "hybrid_top_k" ? 100 : undefined}
                    value={String(form[key] ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      const num = v === "" ? undefined : (key === "context_turns" || key === "match_count" || key === "rrf_k" || key === "hybrid_top_k" ? parseInt(v, 10) : Number(v));
                      setForm((f) => ({ ...f, [key]: num }));
                    }}
                    className="max-w-[200px]"
                  />
                )}
              </div>
            ))}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
