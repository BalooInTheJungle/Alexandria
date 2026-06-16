"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LOGO_YELLOW_PATH } from "@/lib/design";

// ── Translations ──────────────────────────────────────────────────────────────

const t = {
  fr: {
    nav_login: "Connexion",
    hero_tag: "Outil de recherche scientifique IA",
    hero_title: "Votre corpus.\nVotre veille.\nVotre assistant.",
    hero_sub:
      "Alexandria centralise votre bibliothèque scientifique, surveille la littérature mondiale et vous aide à lire plus vite — sans quitter votre domaine.",
    cta: "Accéder à l'application",
    modules_title: "Trois modules, un seul outil",
    modules_sub:
      "Conçu pour les chercheurs qui n'ont pas le temps de tout lire.",
    m1_tag: "Module 1",
    m1_title: "Veille bibliographique",
    m1_desc:
      "Chaque matin, Alexandria parcourt 44 sources RSS et 200 millions d'articles Semantic Scholar. Seuls les articles proches de vos travaux remontent — scorés par similarité sémantique avec votre corpus.",
    m1_b1: "Score de similarité sémantique",
    m1_b2: "Filtre ASAP / preprints automatique",
    m1_b3: "Synthèse IA quotidienne",
    m1_b4: "Sources RSS + Semantic Scholar",
    m2_tag: "Module 2 — Bientôt",
    m2_title: "Lecture assistée",
    m2_desc:
      "Identifiez un article pertinent ? Alexandria vous aide à le lire. Résumé structuré, connexions avec votre corpus, autres publications de l'auteur — sans uploader le PDF si l'abstract suffit.",
    m2_b1: "Résumé Problème / Méthode / Résultats",
    m2_b2: "Articles du corpus les plus proches",
    m2_b3: "Autres travaux de l'auteur (OpenAlex)",
    m2_b4: "Analyse complète sur upload PDF",
    m3_tag: "Module 3",
    m3_title: "RAG sur corpus",
    m3_desc:
      "Interrogez directement vos 850 000+ chunks de littérature scientifique en langage naturel. Réponses sourcées, streaming, historique de conversations.",
    m3_b1: "Recherche hybride vectorielle + FTS",
    m3_b2: "Réponses sourcées avec citations",
    m3_b3: "Streaming SSE",
    m3_b4: "Historique de conversations",
    stats_title: "Ce que dit la recherche",
    stats_sub:
      "Sondage mené auprès de 39 chercheurs — doctorants et enseignants-chercheurs.",
    s1_val: "95%",
    s1_label: "ratent des publications importantes faute de temps",
    s2_val: "46%",
    s2_label: "citent la lecture et synthèse comme activité la plus chronophage",
    s3_val: "62%",
    s3_label: "font leur veille manuellement",
    s4_val: "36%",
    s4_label: "passent trop de temps à trier et filtrer",
    how_title: "Comment ça fonctionne",
    h1_title: "Corpus ingéré",
    h1_desc: "Vos PDFs sont découpés en chunks, traduits si besoin, et indexés avec des embeddings 384D dans Supabase pgvector.",
    h2_title: "Veille quotidienne",
    h2_desc: "Un pipeline GitHub Actions tourne à 9h chaque matin : RSS, Semantic Scholar, scoring sémantique, analyse GPT.",
    h3_title: "Interface unifiée",
    h3_desc: "Veille scorée, lecture assistée et RAG chat dans une seule interface — sans changer d'outil.",
    footer_made: "Construit pour la recherche académique.",
    footer_stack: "Next.js · Supabase · OpenAI · Semantic Scholar",
  },
  en: {
    nav_login: "Login",
    hero_tag: "AI Scientific Research Tool",
    hero_title: "Your corpus.\nYour monitoring.\nYour assistant.",
    hero_sub:
      "Alexandria centralizes your scientific library, monitors global literature and helps you read faster — without leaving your field.",
    cta: "Open the app",
    modules_title: "Three modules, one tool",
    modules_sub: "Built for researchers who don't have time to read everything.",
    m1_tag: "Module 1",
    m1_title: "Literature Monitoring",
    m1_desc:
      "Every morning, Alexandria scans 44 RSS sources and 200 million Semantic Scholar papers. Only papers close to your work surface — scored by semantic similarity with your corpus.",
    m1_b1: "Semantic similarity score",
    m1_b2: "Automatic ASAP / preprint filter",
    m1_b3: "Daily AI synthesis",
    m1_b4: "RSS + Semantic Scholar sources",
    m2_tag: "Module 2 — Coming soon",
    m2_title: "Assisted Reading",
    m2_desc:
      "Found a relevant paper? Alexandria helps you read it. Structured summary, connections to your corpus, other publications by the same author — no PDF upload needed if the abstract is enough.",
    m2_b1: "Problem / Method / Results summary",
    m2_b2: "Closest papers in your corpus",
    m2_b3: "Other works by the author (OpenAlex)",
    m2_b4: "Full analysis on PDF upload",
    m3_tag: "Module 3",
    m3_title: "RAG on Corpus",
    m3_desc:
      "Query your 850,000+ chunks of scientific literature in plain language. Sourced answers, streaming, conversation history.",
    m3_b1: "Hybrid vector + FTS search",
    m3_b2: "Sourced answers with citations",
    m3_b3: "SSE streaming",
    m3_b4: "Conversation history",
    stats_title: "What research shows",
    stats_sub:
      "Survey conducted with 39 researchers — PhD students and faculty.",
    s1_val: "95%",
    s1_label: "miss important publications due to lack of time",
    s2_val: "46%",
    s2_label: "cite reading and synthesis as the most time-consuming activity",
    s3_val: "62%",
    s3_label: "do their literature monitoring manually",
    s4_val: "36%",
    s4_label: "spend too much time sorting and filtering",
    how_title: "How it works",
    h1_title: "Corpus ingested",
    h1_desc: "Your PDFs are chunked, translated if needed, and indexed with 384D embeddings in Supabase pgvector.",
    h2_title: "Daily monitoring",
    h2_desc: "A GitHub Actions pipeline runs at 9am every morning: RSS, Semantic Scholar, semantic scoring, GPT analysis.",
    h3_title: "Unified interface",
    h3_desc: "Scored monitoring, assisted reading and RAG chat in one interface — no tool switching.",
    footer_made: "Built for academic research.",
    footer_stack: "Next.js · Supabase · OpenAI · Semantic Scholar",
  },
} as const;

type Lang = keyof typeof t;

// ── Components ────────────────────────────────────────────────────────────────

function Bullet({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <span className="mt-0.5 text-yellow-500">✦</span>
      {text}
    </li>
  );
}

function ModuleCard({
  tag,
  title,
  desc,
  bullets,
  soon,
}: {
  tag: string;
  title: string;
  desc: string;
  bullets: string[];
  soon?: boolean;
}) {
  return (
    <div className={`relative rounded-2xl border p-6 flex flex-col gap-4 ${soon ? "border-yellow-400/40 bg-yellow-500/5" : "border-border bg-card"}`}>
      {soon && (
        <span className="absolute top-4 right-4 text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-600">
          Soon
        </span>
      )}
      <div>
        <p className="text-xs font-semibold text-yellow-500 uppercase tracking-widest mb-1">{tag}</p>
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
      <ul className="flex flex-col gap-2 mt-auto pt-2 border-t border-border">
        {bullets.map((b) => <Bullet key={b} text={b} />)}
      </ul>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 text-center flex flex-col gap-2">
      <span className="text-4xl font-bold text-yellow-500">{value}</span>
      <span className="text-sm text-muted-foreground leading-snug">{label}</span>
    </div>
  );
}

function StepCard({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-600 text-sm font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <div>
        <p className="font-semibold text-sm mb-1">{title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("fr");
  const T = t[lang];

  return (
    <div className="min-h-screen bg-background text-foreground font-[family-name:var(--font-unbounded)]">

      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Image src={LOGO_YELLOW_PATH} alt="Alexandria" width={120} height={36} className="h-8 w-auto" />
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
            >
              {lang === "fr" ? "EN" : "FR"}
            </button>
            <Link
              href="/login"
              className="text-sm font-medium px-4 py-1.5 rounded-lg bg-yellow-500 text-black hover:bg-yellow-400 transition-colors"
            >
              {T.nav_login}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-24 pb-20 text-center">
        <p className="text-xs font-semibold text-yellow-500 uppercase tracking-widest mb-4">{T.hero_tag}</p>
        <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight whitespace-pre-line mb-6">
          {T.hero_title}
        </h1>
        <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed mb-10">
          {T.hero_sub}
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-yellow-500 text-black font-semibold hover:bg-yellow-400 transition-colors text-sm"
        >
          {T.cta} →
        </Link>
      </section>

      {/* Modules */}
      <section className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">{T.modules_title}</h2>
          <p className="text-muted-foreground text-sm">{T.modules_sub}</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <ModuleCard
            tag={T.m1_tag}
            title={T.m1_title}
            desc={T.m1_desc}
            bullets={[T.m1_b1, T.m1_b2, T.m1_b3, T.m1_b4]}
          />
          <ModuleCard
            tag={T.m2_tag}
            title={T.m2_title}
            desc={T.m2_desc}
            bullets={[T.m2_b1, T.m2_b2, T.m2_b3, T.m2_b4]}
            soon
          />
          <ModuleCard
            tag={T.m3_tag}
            title={T.m3_title}
            desc={T.m3_desc}
            bullets={[T.m3_b1, T.m3_b2, T.m3_b3, T.m3_b4]}
          />
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-5xl mx-auto px-4 py-16 border-t border-border">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">{T.stats_title}</h2>
          <p className="text-muted-foreground text-sm">{T.stats_sub}</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard value={T.s1_val} label={T.s1_label} />
          <StatCard value={T.s2_val} label={T.s2_label} />
          <StatCard value={T.s3_val} label={T.s3_label} />
          <StatCard value={T.s4_val} label={T.s4_label} />
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-4 py-16 border-t border-border">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold">{T.how_title}</h2>
        </div>
        <div className="max-w-xl mx-auto flex flex-col gap-8">
          <StepCard n="1" title={T.h1_title} desc={T.h1_desc} />
          <StepCard n="2" title={T.h2_title} desc={T.h2_desc} />
          <StepCard n="3" title={T.h3_title} desc={T.h3_desc} />
        </div>
      </section>

      {/* CTA bottom */}
      <section className="max-w-5xl mx-auto px-4 py-16 border-t border-border text-center">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-yellow-500 text-black font-semibold hover:bg-yellow-400 transition-colors text-sm"
        >
          {T.cta} →
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <Image src={LOGO_YELLOW_PATH} alt="Alexandria" width={80} height={24} className="h-5 w-auto opacity-60" />
          <span>{T.footer_made}</span>
          <span>{T.footer_stack}</span>
        </div>
      </footer>

    </div>
  );
}
