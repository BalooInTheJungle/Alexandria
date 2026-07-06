# Structure et architecture du projet Alexandria

**Objectif** : document de référence décrivant l'architecture et la structure des dossiers **telles qu'elles existent aujourd'hui** dans le code (juin 2026).

> Ce document a été entièrement réécrit le 06/07/2026 : la version précédente décrivait un plan d'avant-implémentation (veille par scraping HTML + LLM, page RAG unique) qui n'a jamais été celui retenu. Voir `docs/DECISIONS.md` pour l'historique des choix.

---

## 1. Les 3 modules actifs

| Module | Rôle |
|--------|------|
| **Veille** | 49 sources actives (44 RSS + 2 OpenAlex + 1 Semantic Scholar, dont 2 RSS orphelines non fonctionnelles) → scoring sémantique quotidien vs corpus → synthèse IA |
| **Lecture assistée / Analyse** | Upload PDF → résumé structuré + discussion IA + citations cliquables + PDF scroll sync + intégration corpus |
| **Database** | KPIs corpus, carte UMAP 2D, comparaison articles auteur vs corpus |

Le chatbot RAG autonome (page `/rag`) a été **retiré du front en juin 2026** : la tuyauterie (`lib/rag/`, `app/api/rag/`) est conservée et **réutilisée par le module Analyse** (recherche hybride, citations, réglages).

---

## 2. Architecture logique

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        FRONT NEXT.JS 14 (App Router)                       │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Bibliographie │  │ Analyse           │  │ Database     │  │ Auth       │  │
│  │ (veille ≥75%, │  │ (upload PDF,      │  │ (KPIs, UMAP, │  │ (login     │  │
│  │  historique,   │  │  résumé, chat,    │  │  comparaison) │  │  Supabase) │  │
│  │  sources)      │  │  intégration)     │  │              │  │            │  │
│  └──────┬────────┘  └────────┬──────────┘  └──────┬───────┘  └─────┬──────┘  │
└─────────┼────────────────────┼─────────────────────┼─────────────────┼───────┘
          │                    │                     │                 │
          ▼                    ▼                     ▼                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          API ROUTES (Next.js)                              │
│  /api/veille/*       /api/analyse/*        /api/corpus/*      Supabase Auth │
│  (list, items,       (upload, insights,     (map, timeline,                 │
│   runs, stats)        chat SSE, integrate)   author-articles)               │
└─────────┼────────────────────┼─────────────────────┼─────────────────┼───────┘
          │                    │                     │                 │
          ▼                    ▼                     ▼                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                              SUPABASE (cloud)                              │
│  ┌──────────────────────┐  ┌──────────────────┐  ┌─────────────────────┐   │
│  │ Postgres + pgvector    │  │ Storage           │  │ Auth                 │   │
│  │ (documents, chunks,    │  │ bucket "analyses" │  │ (users)              │   │
│  │  veille_items/_runs,   │  │ (PDFs uploadés)   │  │                      │   │
│  │  sources)              │  │                   │  │                      │   │
│  └──────────────────────┘  └──────────────────┘  └─────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
          ▲
          │ (hors requête utilisateur — job planifié)
┌───────────────────────────────────────────────────────────────────────────┐
│           GITHUB ACTIONS — pipeline veille (7h UTC, 4 jobs Node.js)         │
│  extract.ts → score.ts → recap-articles.ts → recap-global.ts               │
│  (+ extract-semanticscholar.ts en parallèle si activé)                     │
└───────────────────────────────────────────────────────────────────────────┘
```

Point important par rapport à l'ancienne version de ce doc : **la veille ne tourne plus sur Vercel/API routes** mais entièrement dans **GitHub Actions** (scripts Node.js dans `scripts/veille/`), pour éviter le timeout 10s du plan Vercel Hobby. Les API routes `/api/veille/*` ne font que **lire** les résultats déjà en base pour le front.

---

## 3. Modèle de données (Supabase) — résumé

- **auth.users** : utilisateurs (Supabase Auth), login requis pour tout le dashboard.
- **documents** : métadonnées PDF (titre, auteurs, DOI, journal, date, `storage_path`), avec `is_author_article boolean` (articles publiés du chercheur, indexés séparément du corpus général).
- **document_analyses** : documents uploadés via le module Analyse (`status`, lien Storage bucket `analyses`).
- **chunks** : texte + `embedding vector(384)` (+ `embedding_fr`, hérité, non utilisé activement) + `document_id`, position, page, `is_temp` (chunks d'une analyse pas encore intégrée au corpus).
- **sources** : 49 sources de veille actives (RSS, OpenAlex direct, ou Semantic Scholar), gérées en base — voir `documentation/SOURCES_JOURNAUX.md` pour le détail (2 sources RSS orphelines n'y contribuent en réalité rien).
- **veille_runs** : une exécution quotidienne (statut, `phase`, `pipeline_logs`, `ai_summary` = `{ themes[], synthesis }`).
- **veille_items** : un article détecté par un run — `similarity_score` (vs corpus complet), `author_score` (vs articles auteur uniquement), `corpus_refs` (passages ≥75% ayant déclenché le score), `ai_analysis` (`{ contribution, relevance, corpus_link }`, rempli seulement si ≥75%), `is_relevant` (évaluation manuelle du chercheur : `NULL`/`true`/`false`), `read_at`.
- **ss_representative_papers** : articles auteur pré-calculés servant de base aux recommandations Semantic Scholar (Job 1b).
- **rag_settings** : réglages relus à chaque requête chat (paramétrage dynamique de la génération).
- **Index** : GIN FTS sur `chunks` (`content_tsv`), index IVFFlat vectoriel sur `chunks.embedding` (`lists=100`), à reconstruire après chaque ingestion bulk.

Schéma SQL détaillé : `documentation/SCHEMA_DB_ET_DONNEES.md` + `supabase/migrations/` (52 migrations, ordre chronologique).

---

## 4. Structure réelle des dossiers

```
alexandria/
├── app/
│   ├── page.tsx                       # Landing page publique FR/EN
│   ├── (auth)/login/                  # Login Supabase Auth
│   ├── (dashboard)/                   # Groupe protégé, layout commun (nav)
│   │   ├── bibliographie/             # Veille ≥75% (tab) + historique runs + sources
│   │   │   ├── documents/             # Liste/consultation des documents du corpus
│   │   │   └── historique/[runId]/    # Détail d'un run de veille
│   │   ├── analyse/                   # Liste analyses + upload
│   │   │   └── [id]/                  # 4 onglets : Proximité / Résumé / Discussion / Aller plus loin
│   │   ├── database/                  # KPIs, UMAP, comparaison auteur vs corpus
│   │   └── veille/                    # Route legacy → redirect vers /bibliographie
│   └── api/
│       ├── analyse/                   # upload, insights, chat (SSE), pdf, integrate, suggestions, warmup
│       ├── veille/                    # list, items, items/top, runs, stats, sources, days
│       ├── corpus/                    # map (UMAP), timeline, author-articles, journals
│       ├── documents/                 # count, stats, upload
│       ├── rag/                       # search, chat, conversations, settings — legacy, réutilisé par Analyse
│       └── cron/retention/            # Nettoyage conversations > 30 jours (cron Vercel)
│
├── lib/
│   ├── supabase/                      # client.ts (browser), server.ts, admin.ts (service role)
│   ├── db/                            # Accès données (documents, chunks, sources, veille, query-logs, types)
│   ├── rag/                           # embed.ts (Xenova 384D), search.ts, openai.ts, rerank.ts,
│   │                                  # citations.ts, settings.ts, conversation-persistence.ts
│   ├── veille/                        # fetch-rss.ts, openalex.ts, crossref.ts, score.ts, summarize.ts,
│   │                                  # sources.ts, pipeline.ts, clean-article-html.ts,
│   │                                  # filter-article-display.ts, detect-bot-challenge.ts
│   ├── ingestion/                     # parse-pdf.ts, chunk.ts, index.ts
│   ├── auth/middleware.ts
│   └── design/                        # Tokens couleurs/typo partagés
│
├── components/
│   ├── ui/                            # shadcn/ui
│   ├── analyse/                       # AnalysisChatPanel, AnalysisPdfViewer
│   ├── veille/                        # VeilleDashboard, VeilleArticleCard
│   ├── bibliographie/
│   ├── dashboard/                     # NavLinks
│   └── layout/
│
├── scripts/
│   ├── ingest.py                      # Ingestion PDF bulk (Python) — flag --author
│   ├── fix_author_titles.py, fix_spaced_chunks.py, compute_umap.py
│   ├── compute-ss-representatives.ts
│   ├── import-sources.ts
│   └── veille/                        # Pipeline veille — tourne dans GitHub Actions, pas sur Vercel
│       ├── extract.ts                 # Job 1 : fetch RSS + OpenAlex + filtre finalisation
│       ├── extract-semanticscholar.ts # Job 1b (optionnel) : recs Semantic Scholar
│       ├── score.ts                   # Job 2 : embedding + match_chunks + match_author_chunks
│       ├── score-author.ts            # Script rétroactif author_score
│       ├── recap-articles.ts          # Job 3 : GPT analyse individuelle ≥75%
│       └── recap-global.ts            # Job 4 : GPT synthèse globale
│
├── data/                              # Hors Git (voir .gitignore)
│   ├── pdfs2/YEAR/                    # Corpus PDF, organisé par année de publication
│   └── Articles auteur/YEAR/          # Articles publiés du chercheur
│
├── documentation/                     # Docs techniques détaillées (ce dossier)
├── docs/                              # Vision, architecture, roadmap, décisions, glossaire
├── context/                           # État de session, profil de travail, logs
├── agents/                            # Guides spécialisés (session, debug)
├── skills/                            # Recettes réutilisables
├── supabase/migrations/               # 52 migrations SQL
├── .github/workflows/veille-cron.yml  # Cron GitHub Actions, 7h UTC
└── vercel.json                        # Cron retention, 4h UTC
```

**Écarts avec l'ancien plan (pour mémoire)** :
- Pas de page `rag/` dans le dashboard (retirée) ; la nav ne montre plus que Bibliographie / Analyse / Database.
- Pas de `lib/veille/filter-urls-llm.ts` ni `extract-article-llm.ts` : le filtrage par LLM d'URLs scrapées a été abandonné au profit de flux RSS structurés + vérification de finalisation via OpenAlex/CrossRef (pas de LLM dans cette étape).
- `documents/` (upload manuel PDF par le prof) n'est plus le flux principal d'ingestion : le corpus est alimenté par ingestion bulk Python (`scripts/ingest.py`), le module **Analyse** gère l'upload ponctuel côté utilisateur avec option d'intégration au corpus.

---

## 5. Flux principaux

### Veille (automatique, sans action utilisateur)
Cron GitHub Actions 7h UTC → **Job 1** `extract.ts` (fetch sources RSS + OpenAlex direct, **fenêtre 3 jours** — `LOOKBACK_DAYS` dans `extract.ts` ; le pipeline legacy manuel reste à 7 jours, voir `PIPELINE_VEILLE_CONSOLIDE.md` §4 — filtre finalisation DOI via OpenAlex batch + fallback CrossRef, dédup DOI) → **Job 1b** optionnel `extract-semanticscholar.ts` en parallèle (recommandations SS basées sur `ss_representative_papers`) → **Job 2** `score.ts` (embedding abstract Xenova 384D → `match_chunks` + `match_author_chunks` en parallèle → `similarity_score` + `author_score` + `corpus_refs`) → **Job 3** `recap-articles.ts` (GPT-4o-mini sur articles ≥75% → `ai_analysis`) → **Job 4** `recap-global.ts` (GPT-4o-mini → synthèse `ai_summary`, run marqué `completed`) → front `/bibliographie` affiche les articles ≥75%, pagination, lu/non lu, évaluation pertinence manuelle.

### Analyse (module Lecture assistée)
Upload PDF → `POST /api/analyse/upload` (parse, chunk, embed, `document_analyses` status=ready, chunks `is_temp=true`) → `GET /api/analyse/[id]/insights` (résumé GPT + `corpus_refs` + `author_score` + références citées Semantic Scholar + recommandations SS, calcul parallèle avec cache) → page `/analyse/[id]` (4 onglets) → `POST /api/analyse/[id]/chat` (discussion streaming SSE, citations [N], sync scroll PDF) → `POST /api/analyse/[id]/integrate` (`is_temp=false`, intégration définitive au corpus).

### Ingestion bulk (corpus général)
`data/pdfs2/YEAR/` → `python3 scripts/ingest.py` (parse, chunk, embed, insert `documents`+`chunks`, rebuild IVFFlat automatique) ; `--author` pour `data/Articles auteur/` (puis relancer `compute-ss-representatives.ts` pour les recs Semantic Scholar).

---

## 6. Pour aller plus loin

- Détail des seuils veille (75%, finalisation, etc.) : `documentation/PIPELINE_VEILLE_CONSOLIDE.md`.
- Page Database (KPIs, cartographie, routes orphelines) : `documentation/DATABASE_PAGE.md`.
- Schéma SQL complet : `documentation/SCHEMA_DB_ET_DONNEES.md`.
- Historique des décisions d'architecture : `docs/DECISIONS.md`.
- Roadmap et état d'avancement : `docs/ROADMAP.md`, `CLAUDE.md` (section "État actuel").
