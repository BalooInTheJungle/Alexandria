"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Source } from "@/lib/db/types";

// ─── Add Source Dialog ────────────────────────────────────────────────────────

interface AddSourceDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded: (source: Source) => void;
}

function AddSourceDialog({ open, onClose, onAdded }: AddSourceDialogProps) {
  const [name, setName] = useState("");
  const [publisher, setPublisher] = useState("");
  const [issn, setIssn] = useState("");
  const [url, setUrl] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(""); setPublisher(""); setIssn(""); setUrl(""); setRssUrl(""); setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) { setError("Nom et URL sont obligatoires."); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/veille/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          publisher: publisher.trim() || null,
          issn: issn.trim() || null,
          url: url.trim(),
          rss_url: rssUrl.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Erreur serveur"); return; }
      const { source } = await res.json();
      onAdded(source);
      reset();
      onClose();
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="bg-[#1C1404] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#FECC66]">Ajouter une source</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs">Nom du journal *</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="Journal of the American Chemical Society"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs">Éditeur</Label>
            <Input value={publisher} onChange={e => setPublisher(e.target.value)}
              placeholder="ACS"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs">ISSN</Label>
            <Input value={issn} onChange={e => setIssn(e.target.value)}
              placeholder="0002-7863"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs">URL du journal *</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://pubs.acs.org/journal/jacsat"
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-white/70 text-xs">URL RSS <span className="text-white/40">(vide → OpenAlex)</span></Label>
            <Input value={rssUrl} onChange={e => setRssUrl(e.target.value)}
              placeholder="https://pubs.acs.org/action/showFeed?..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div className="flex justify-end gap-2 mt-1">
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}
              className="text-white/60 hover:text-white">Annuler</Button>
            <Button type="submit" disabled={loading}
              className="bg-[#FECC66] text-[#1C1404] hover:bg-[#FECC66]/90 font-medium">
              {loading ? "Ajout…" : "Ajouter"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Source Row ───────────────────────────────────────────────────────────────

interface SourceRowProps {
  source: Source;
  onToggle: (id: string, active: boolean) => void;
}

function SourceRow({ source, onToggle }: SourceRowProps) {
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`flex items-center justify-between py-2 px-3 rounded-lg transition-opacity ${source.active ? "opacity-100" : "opacity-40"}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${source.active ? "bg-green-400" : "bg-white/20"}`} />
        <a
          href={source.rss_url ?? source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-white truncate hover:text-[#FECC66] hover:underline transition-colors"
        >
          {source.name}
        </a>
        <span className="text-xs text-white/30 shrink-0">{source.source_type.toUpperCase()}</span>
        {source.issn && <span className="text-xs text-white/20 shrink-0 font-mono">{source.issn}</span>}
        {!source.active && (
          <span className="text-xs bg-white/10 text-white/40 px-1.5 py-0.5 rounded shrink-0">Désactivée</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        disabled={loading}
        className={`shrink-0 text-xs h-7 px-2.5 ${
          source.active
            ? "text-white/40 hover:text-red-400 hover:bg-red-400/10"
            : "text-white/40 hover:text-green-400 hover:bg-green-400/10"
        }`}
      >
        {source.active ? "Désactiver" : "Activer"}
      </Button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPublisher, setFilterPublisher] = useState("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/veille/sources")
      .then(r => r.json())
      .then(d => { setSources(d.sources ?? []); setLoading(false); })
      .catch(() => { setError("Impossible de charger les sources."); setLoading(false); });
  }, []);

  function handleToggle(id: string, active: boolean) {
    setSources(prev => prev.map(s => s.id === id ? { ...s, active } : s));
  }

  function handleAdded(source: Source) {
    setSources(prev => [...prev, source]);
  }

  const publishers = useMemo(() => {
    const set = new Set(sources.map(s => s.publisher ?? "Autre"));
    return ["all", ...Array.from(set).sort()];
  }, [sources]);

  const filtered = useMemo(() => {
    return sources.filter(s => {
      if (activeOnly && !s.active) return false;
      if (filterPublisher !== "all" && (s.publisher ?? "Autre") !== filterPublisher) return false;
      return true;
    });
  }, [sources, activeOnly, filterPublisher]);

  const grouped = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of filtered) {
      const key = s.publisher ?? "Autre";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const totalActive = sources.filter(s => s.active).length;

  return (
    <main className="flex flex-col h-[calc(100vh-60px)] bg-[#0f0a01] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div>
          <h1 className="text-lg font-semibold text-white">Sources de veille</h1>
          <p className="text-xs text-white/40 mt-0.5">
            {sources.length} sources — {totalActive} actives
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-[#FECC66] text-[#1C1404] hover:bg-[#FECC66]/90 font-medium text-sm"
        >
          + Ajouter une source
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-white/5">
        <select
          value={filterPublisher}
          onChange={e => setFilterPublisher(e.target.value)}
          className="bg-white/5 border border-white/10 text-white/80 text-sm rounded px-2 py-1.5 focus:outline-none focus:border-white/20"
        >
          {publishers.map(p => (
            <option key={p} value={p} className="bg-[#1C1404]">
              {p === "all" ? "Tous les éditeurs" : p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-white/60 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
            className="accent-[#FECC66]"
          />
          Actives seulement
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-white/40 text-sm">Chargement…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!loading && !error && grouped.length === 0 && (
          <p className="text-white/40 text-sm">Aucune source trouvée.</p>
        )}
        {grouped.map(([publisher, srcs]) => (
          <div key={publisher} className="mb-6">
            <h2 className="text-xs font-semibold text-[#FECC66]/70 uppercase tracking-widest mb-2 px-3">
              {publisher}
            </h2>
            <div className="flex flex-col gap-0.5">
              {srcs.map(s => (
                <SourceRow key={s.id} source={s} onToggle={handleToggle} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <AddSourceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onAdded={handleAdded}
      />
    </main>
  );
}
