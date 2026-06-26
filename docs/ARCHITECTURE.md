# ARCHITECTURE — Schéma technique Alexandria

Référence : structure des modules, schéma DB, clients Supabase, déploiement.

---

## Vue d'ensemble

```
Utilisateur
    │
    ▼
Next.js 14 (App Router) — hébergé sur Vercel
    │
    ├── Front (React + Tailwind + shadcn/ui)
    │       app/                           → landing page publique (FR/EN)
    │       app/(auth)/login               → login Supabase Auth
    │       app/(dashboard)/bibliographie  → veille + historique runs + sources
    │       app/(dashboard)/database       → KPIs corpus, UMAP, analytics
    │       app/(dashboard)/analyse        → upload PDF + lecture assistée + analyse
    │         └── [id]/page.tsx            → 4 onglets : Proximité / Résumé / Discussion / Aller plus loin
    │
    └── API Routes
            /api/analyse/*      → upload, insights, chat, pdf, integrate, suggestions, warmup
            /api/veille/*       → list, status, runs, items, stats
            /api/cron/*         → rétention conversations (Vercel cron)
            /api/corpus/*       → author-articles, similar (dataviz Database)
                │
                ▼
        Supabase (Postgres + pgvector + Auth + Storage)
        OpenAI API (gpt-4o-mini)
        @xenova/transformers (embed local 384D, all-MiniLM-L6-v2)
        Semantic Scholar API (recommandations, métadonnées)

Scripts Python (manuels, hors Vercel)
    scripts/ingest.py              → ingestion PDF bulk + articles auteur
    scripts/fix_spaced_chunks.py   → correction texte espacé dans les chunks
    scripts/fix_author_titles.py   → correction titres espacés articles auteur
    scripts/compute_umap.py        → coordonnées UMAP 2D sur les chunks
    scripts/veille/extract.ts      → Job 1 pipeline veille (GitHub Actions)
    scripts/veille/score.ts        → Job 2 scoring sémantique
    scripts/veille/recap-articles.ts → Job 3 analyse IA par article ≥ 75%
    scripts/veille/recap-global.ts   → Job 4 synthèse globale
    scripts/compute-ss-representatives.ts → calcul articles représentatifs pour Semantic Scholar
```

---

## Schéma de base de données

### Tables principales

| Table | Rôle |
|-------|------|
| `documents` | Métadonnées PDFs ingérés (titre, DOI, storage_path, status, is_author_article) |
| `chunks` | Fragments texte avec embeddings EN 384D, FTS, colonnes UMAP, is_temp / analysis_id |
| `sources` | 44+ sources de veille (ISSN, RSS URL, fetch_strategy, active) |
| `veille_runs` | Historique runs veille (status, phase, pipeline_logs, ai_summary) |
| `veille_items` | Articles récupérés (DOI, abstract, similarity_score, ai_analysis, corpus_refs, read_at) |
| `document_analyses` | Analyses de documents uploadés (summary, corpus_refs, cited_refs, ss_recs, is_integrated) |
| `ss_representative_papers` | Articles auteur représentatifs pour les recommandations Semantic Scholar |
| `rag_settings` | Paramètres dynamiques RAG (seuils, poids, k) — legacy, utilisé par /api/rag/* |
| `conversations` | Sessions de chat RAG — vide (chatbot retiré) |
| `messages` | Messages user + assistant — vide (chatbot retiré) |

### Table chunks (critique)

```sql
chunks (
  id uuid,
  document_id uuid,
  content text,             -- texte EN
  embedding vector(384),    -- vecteur EN (IVFFlat)
  content_tsv tsvector,     -- FTS EN (trigger automatique)
  position int,             -- ordre dans le document
  page int,                 -- numéro de page source
  section_title text,       -- section détectée
  umap_x float, umap_y float, -- coordonnées UMAP 2D (compute_umap.py)
  is_author_article bool,   -- chunk d'article auteur (ingest.py --author)
  analysis_id uuid,         -- lien vers document_analyses (nullable)
  is_temp bool              -- true si chunks d'analyse non intégrés
)
```

**Règles immuables :**
- `vector(384)` — dimension fixe, ne jamais modifier
- `content_tsv` — écrit par trigger Postgres, ne pas écrire directement
- Index IVFFlat `idx_chunks_embedding` (lists=100) — à rebuilder après ingestion bulk > 50k chunks

### Table document_analyses

```sql
document_analyses (
  id uuid,
  user_id uuid,
  document_id uuid,         -- lié au document dans chunks (can be null si supprimé)
  title text,
  doi text,
  ss_paper_id text,         -- paperId Semantic Scholar (pour les recs)
  status text,              -- pending | processing | ready | completed | error
  summary jsonb,            -- { tldr, intro, methods, results, discussion }
  corpus_refs jsonb,        -- [{ doc_title, excerpt, page, similarity }]
  cited_refs jsonb,         -- [{ doi, in_corpus, title, year, authors[] }]
  ss_recs jsonb,            -- [{ title, authors[], year, doi, abstract }]
  is_integrated bool,       -- true si chunks rendus permanents
  expires_at timestamptz,   -- null si is_integrated, sinon +7 jours
  created_at, updated_at
)
```

### Table veille_items

```sql
veille_items (
  id uuid,
  run_id uuid,
  doi text UNIQUE,
  title text, abstract text, authors text[], journal_name text,
  published_at date,
  url text,
  source_type text,         -- 'rss' | 'openalex' | 'semantic_scholar'
  similarity_score float,   -- 0 si scoré sans match, null si pas encore scoré
  corpus_refs jsonb,        -- [{ doc_title, excerpt, page, similarity }] passages ≥ 75%
  ai_analysis jsonb,        -- { contribution, relevance, corpus_link } pour ≥ 75%
  is_relevant boolean,      -- null=non évalué, true=pertinent (chercheur), false=non pertinent
  read_at timestamptz       -- null si non lu
)
```

### RPCs Supabase (fonctions SQL)

| RPC | Usage |
|-----|-------|
| `match_chunks(query_embedding, match_count, match_threshold)` | Recherche vectorielle EN (cosinus) — utilisé par insights + chat Analyse |
| `search_chunks_fts(query_text, match_count)` | Recherche FTS EN |
| `match_corpus_docs(...)` | Agrège les chunks par document pour les articles auteur |
| `get_author_representative_titles()` | Retourne les articles auteur représentatifs (centroïde) |
| `get_veille_runs_with_counts()` | Runs avec compteurs items/pertinents/analyses |
| `get_corpus_top_terms(...)` | Top termes du corpus (word cloud) |
| `get_corpus_stats()` | KPIs globaux corpus |

### Migrations (ordre chronologique, 50 au total)

```
20260204100000_enable_pgvector.sql
... (socle V1 : sources, documents, chunks, veille, RLS, RPCs)
20260504100000_sources_active.sql
20260504110000_veille_run_summary.sql       — ai_summary dans veille_runs
20260505120000_veille_items_corpus_refs.sql — corpus_refs sur veille_items
20260505130000_query_logs.sql
20260505140000_chunks_umap.sql              — umap_x, umap_y sur chunks
20260526100000_documents_author_flag.sql    — is_author_article
20260526110000_match_corpus_by_author_doc.sql
20260526120000_match_corpus_docs_rpc.sql
20260529100000_veille_run_logs.sql          — pipeline_logs jsonb
20260603100000_corpus_stats_rpcs.sql
20260603130000_veille_items_read_at.sql     — read_at (lu/non lu)
20260603140000_veille_items_ai_analysis.sql — ai_analysis jsonb
20260608100000_veille_items_doi_unique.sql  — contrainte unicité DOI
20260616100000_sources_semantic_scholar.sql
20260616110000_rpc_author_representative_titles.sql
20260616120000_ss_representative_papers.sql
20260617100000_document_analyses.sql        — table analyses + chunks.is_temp/analysis_id
```

---

## Clients Supabase

| Fichier | Type | Quand l'utiliser |
|---------|------|-----------------|
| `lib/supabase/client.ts` | Browser | Composants React client (`'use client'`) |
| `lib/supabase/server.ts` | Server (cookies) | API routes standard (respecte RLS) |
| `lib/supabase/admin.ts` | Service role | Scripts veille GitHub Actions + cron rétention |

---

## Pipeline Analyse — flux technique

```
POST /api/analyse/upload
    │
    ├── Auth vérifiée
    ├── Validation : PDF, < 20 Mo
    ├── parsePdfBuffer() → texte + nb pages
    ├── extractDoi() → regex sur le texte complet
    ├── insert document_analyses (status=processing)
    ├── Supabase Storage bucket "analyses" → upload PDF (analysisId.pdf)
    ├── insert documents (status=processing)
    ├── chunkText() → segments avec position, page, section_title
    ├── embedQuery() par batch de 20 → embedding 384D (Xenova)
    ├── insert chunks (is_temp=true, analysis_id=analysisId)
    └── status → "ready", retourne { analysisId, documentId, chunksCount, doi }

GET /api/analyse/[id]/insights
    │
    ├── Si status=completed → retourne le cache immédiatement
    ├── Si status≠ready → 409
    ├── Charge les chunks (is_temp=true, analysis_id)
    ├── Calcule embedding moyen (représente l'article entier)
    ├── extractCitedDois() → regex sur le texte complet
    │
    ├── [PARALLÈLE]
    │     ├── generateSummary() → GPT-4o-mini → { tldr, intro, methods, results, discussion }
    │     ├── match_chunks(meanEmbedding, threshold=0.1, count=30) → corpus_refs (top 6)
    │     ├── fetchSsMetadataBatch(citedDois) → titre/auteurs/année pour chaque DOI cité
    │     └── fetchSsPaperId(doi) → paperId SS de l'article analysé
    │
    ├── fetchSsRecs(paperId) → 10 recommandations SS (si paperId trouvé)
    ├── Croisement cited_refs avec documents.doi → in_corpus flag
    └── update document_analyses : status=completed, summary, corpus_refs, cited_refs, ss_recs, ss_paper_id

POST /api/analyse/[id]/chat
    │
    ├── Auth vérifiée
    ├── embedQuery(query) → vecteur 384D
    ├── Chunks du document (direct par document_id, top 10 par position) → cosine sim → top 5
    ├── match_chunks(corpus, threshold=0.5, count=15) → filtrer document analysé → top 3
    ├── buildContext() → "[N] (document analysé / corpus) ...\ncontent"
    ├── OpenAI gpt-4o-mini stream → SSE
    │     event 1 : { sources: [...] }   ← envoyé en premier
    │     events N : { token: "..." }
    │     event last : [DONE]
    └── Réponse en SSE

POST /api/analyse/[id]/integrate
    │
    ├── chunks.is_temp → false  (permanents dans le corpus)
    └── document_analyses.is_integrated → true, expires_at → null
```

---

## Pipeline Veille — flux technique (GitHub Actions, 7h UTC)

```
Job 1 — scripts/veille/extract.ts
    ├── createRun() → veille_runs (status=running)
    ├── 44 sources RSS → fetch parallèle (concurrence=5) → fenêtre 7 jours
    ├── Filtre finalisation : DOI requis → OpenAlex batch is_final → CrossRef fallback
    ├── Rejet : ASAP, preprints, corrections, sans abstract
    ├── Sources OpenAlex directes (MDPI : Magnetochemistry, Inorganics…)
    ├── Dédup DOI en mémoire
    └── Insert batch 50 → veille_items (source_type='rss'|'openalex')

Job 1b — scripts/veille/extract-semanticscholar.ts (si ENABLE_SEMANTIC_SCHOLAR=true)
    ├── Charge ss_representative_papers (pré-calculés)
    ├── POST /recommendations/v1/papers/ → top 100 papers (60j)
    ├── Filtre abstract + dédup DOI
    └── Insert veille_items (source_type='semantic_scholar')

Job 2 — scripts/veille/score.ts
    ├── Charge veille_items avec similarity_score IS NULL
    ├── embedQuery(abstract) → 384D
    ├── match_chunks → top-3 → similarity_score (top-1)
    ├── corpus_refs : chunks ≥ 75% sauvegardés
    └── Batch save 50

Job 3 — scripts/veille/recap-articles.ts
    ├── Articles similarity_score ≥ 75%
    └── GPT-4o-mini → ai_analysis { contribution, relevance, corpus_link }

Job 4 — scripts/veille/recap-global.ts
    ├── Articles ai_analysis IS NOT NULL
    ├── GPT-4o-mini → { themes[], synthesis }
    └── update veille_runs : status=completed, ai_summary
```

---

## Pipeline Ingestion PDF (Python, manuel)

```
scripts/ingest.py  [--author]
    │
    ├── Source : data/pdfs2/YEAR/  (ou data/Articles auteur/ avec --author)
    ├── Dédup : skip si storage_path déjà en base avec status=done
    ├── PyMuPDF → extraction texte par page
    │     └── OCR Tesseract si < 50 chars/page
    ├── fix_spaced_text() → correction texte espacé à l'extraction
    ├── Chunking : CHUNK_SIZE=600, CHUNK_OVERLAP=100
    ├── sentence-transformers all-MiniLM-L6-v2 → embedding EN 384D
    ├── insert chunks (content, embedding, page, section_title)
    │     └── Trigger Postgres → content_tsv automatique
    └── Après tous les inserts : CREATE INDEX CONCURRENTLY IVFFlat (lists=100)
```

---

## Déploiement

### Vercel
| Configuration | Détail |
|--------------|--------|
| Cron rétention | `0 4 * * *` → `GET /api/cron/retention` (supprime conversations > 30j) |
| Redirect post-login | Middleware → `/bibliographie` |
| Routes protégées | `/bibliographie`, `/database`, `/analyse` (middleware.ts) |

### GitHub Actions (`.github/workflows/veille-cron.yml`)
| Déclencheur | 7h UTC (9h Paris) — quotidien |
|-------------|-------------------------------|
| Secrets requis | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` |
| Variable optionnelle | `ENABLE_SEMANTIC_SCHOLAR=true` |
| Durée typique | ~6-8 min (4 jobs séquentiels) |
| Stratégie | `VEILLE_STRATEGY=actions` (défaut) |

---

## Supabase Storage

| Bucket | Contenu | Usage |
|--------|---------|-------|
| `analyses` | PDFs uploadés pour analyse | `GET /api/analyse/[id]/pdf` génère une URL signée 1h |

---

## Variables d'environnement

| Variable | Usage |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client navigateur |
| `SUPABASE_SERVICE_ROLE_KEY` | Scripts + cron (admin) |
| `OPENAI_API_KEY` | GPT-4o-mini (insights + veille) |
| `CRON_SECRET` | Protection routes `/api/cron/*` |
| `SS_API_KEY` | Clé Semantic Scholar (optionnelle — sans clé : 1 req/s) |
