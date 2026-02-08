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
  context_turns: "Nombre de tours de conversation envoyés au modèle",
  similarity_threshold: "Seuil de similarité (détection hors-sujet)",
  guard_message: "Message affiché quand la question est hors-sujet",
  match_count: "Nombre max de passages récupérés par recherche vectorielle",
  match_threshold: "Seuil minimal de similarité pour garder un passage",
  fts_weight: "Poids de la recherche par mots-clés (fusion hybride)",
  vector_weight: "Poids de la recherche par sens (fusion hybride)",
  rrf_k: "Paramètre de fusion des classements (RRF)",
  hybrid_top_k: "Nombre de passages envoyés au modèle après fusion",
};

const DESCRIPTIONS: Record<keyof RagSettings, string> = {
  context_turns:
    "Combien d’échanges récents (question + réponse) sont renvoyés au modèle pour garder le fil de la conversation. Plus c’est élevé, plus le contexte est long.",
  similarity_threshold:
    "Entre 0 et 1. En dessous de ce seuil, la question est jugée hors-sujet et le modèle ne répond pas (message personnalisable ci-dessous). Plus la valeur est basse, plus on accepte de questions éloignées du corpus.",
  guard_message:
    "Texte affiché à l’utilisateur lorsque sa question est considérée comme hors-sujet (voir seuil de similarité ci-dessus).",
  match_count:
    "Nombre maximum de passages (chunks) récupérés par la recherche vectorielle avant fusion. Plus la valeur est haute, plus on récupère de candidats. Valeur typique : 20–50.",
  match_threshold:
    "Entre 0 et 1. Seuil minimal de similarité pour qu’un passage soit gardé. Plus la valeur est basse, plus on accepte des passages un peu moins proches (récupération plus large).",
  fts_weight:
    "Poids de la recherche par mots-clés (full-text) dans la fusion hybride. Plus ce poids est élevé par rapport au poids vectoriel, plus les résultats « mots exacts » comptent.",
  vector_weight:
    "Poids de la recherche par sens (vectorielle) dans la fusion hybride. Plus ce poids est élevé, plus les passages sémantiquement proches comptent.",
  rrf_k:
    "Paramètre k de la formule RRF (Reciprocal Rank Fusion). Plus k est élevé, plus les rangs élevés sont favorisés. En général entre 10 et 100.",
  hybrid_top_k:
    "Après avoir fusionné recherche par mots-clés et par sens, combien de passages garder pour les envoyer au modèle. Plus la valeur est haute, plus le modèle a de contexte (mais réponse potentiellement plus longue ou diffuse).",
};

const BOUNDS: Record<
  keyof RagSettings,
  { min: number; max: number; step?: number } | null
> = {
  context_turns: { min: 1, max: 10, step: 1 },
  similarity_threshold: { min: 0.1, max: 0.9, step: 0.1 },
  guard_message: null,
  match_count: { min: 5, max: 100, step: 1 },
  match_threshold: { min: 0, max: 1, step: 0.1 },
  fts_weight: { min: 0, max: 10, step: 0.1 },
  vector_weight: { min: 0, max: 10, step: 0.1 },
  rrf_k: { min: 1, max: 200, step: 1 },
  hybrid_top_k: { min: 5, max: 100, step: 1 },
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
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {(Object.keys(LABELS) as (keyof RagSettings)[]).map((key) => {
              const bounds = BOUNDS[key];
              const isInt = bounds ? (bounds.step ?? 1) >= 1 : false;
              return (
                <div key={key} className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-4">
                  <Label htmlFor={key} className="text-base font-medium">
                    {LABELS[key]}
                  </Label>
                  <p className="text-sm text-muted-foreground">{DESCRIPTIONS[key]}</p>
                  {bounds && (
                    <p className="text-xs text-muted-foreground">
                      Valeur entre <strong>{bounds.min}</strong> et <strong>{bounds.max}</strong>
                      {bounds.step !== undefined && bounds.step < 1 && " (décimales autorisées)"}.
                    </p>
                  )}
                  {key === "guard_message" ? (
                    <Textarea
                      id={key}
                      value={String(form[key] ?? "")}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      rows={3}
                      className="mt-2 w-full"
                    />
                  ) : bounds ? (
                    <Input
                      id={key}
                      type="number"
                      step={bounds.step ?? 1}
                      min={bounds.min}
                      max={bounds.max}
                      value={String(form[key] ?? "")}
                      onChange={(e) => {
                        const v = e.target.value;
                        const num = v === "" ? undefined : (isInt ? parseInt(v, 10) : Number(v));
                        setForm((f) => ({ ...f, [key]: num }));
                      }}
                      className="mt-2 max-w-[200px]"
                    />
                  ) : null}
                </div>
              );
            })}
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
