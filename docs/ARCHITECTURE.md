# ARCHITECTURE — Schéma technique Alexandria

Référence : structure des modules, schéma DB, clients Supabase, déploiement.
Détail complet → `documentation/STRUCTURE_ET_ARCHITECTURE.md`, `documentation/SCHEMA_DB_ET_DONNEES.md`

---

## Vue d'ensemble

```
Utilisateur
    │
    ▼
Next.js 14 (App Router) — hébergé sur Vercel
    │
    ├── Front (React + Tailwind + shadcn/ui)
    │       app/(auth)/login
    │       app/(dashboard)/rag          → chatbot RAG
    │       app/(dashboard)/bibliographie → veille + documents
    │
    └── API Routes
            /api/rag/*          → pipeline RAG
            /api/veille/*       → pipeline veille
            /api/documents/*    → upload PDF
            /api/ingestion/*    → parse/chunk/embed
            /api/cron/*         → jobs automatiques
                │
                ▼
        Supabase (Postgres + pgvector + Auth)
        OpenAI API (gpt-4o-mini)
        @xenova/transformers (embed local 384D)

Scripts Python (manuels)
    scripts/ingest.py → ingestion PDF complète
    scripts/import-sources.ts → upsert sources veille
```

---

## Schéma de base de données

### Tables principales

| Table | Rôle |
|-------|------|
| `documents` | Métadonnées des PDFs ingérés (titre, DOI, storage_path, status) |
| `chunks` | Fragments de texte avec embeddings (EN + FR) et FTS |
| `sources` | Sources de veille (43+ journaux avec ISSN/RSS URL, colonne `active`) |
| `veille_runs` | Historique des runs de veille (status, date) |
| `veille_items` | Articles récupérés par run (DOI, abstract, score) |
| `conversations` | Sessions de chat RAG |
| `messages` | Messages user + assistant par conversation |
| `rag_settings` | Paramètres dynamiques du RAG (seuils, poids, etc.) |

### Table chunks (critique)

```sql
chunks (
  id uuid,
  document_id uuid,
  content text,           -- texte EN
  embedding vector(384),  -- vecteur EN (HNSW)
  content_tsv tsvector,   -- FTS EN (trigger automatique)
  content_fr text,        -- texte FR (traduit par ingest.py)
  embedding_fr vector(384), -- vecteur FR (HNSW)
  content_fr_tsv tsvector,  -- FTS FR (trigger automatique)
  section text,
  page_number int,
  chunk_index int
)
```

**Règles immuables :**
- `vector(384)` — dimension fixe, ne jamais modifier
- `content_tsv` / `content_fr_tsv` — écrits par triggers Postgres, ne pas toucher directement

### RPCs Supabase (fonctions SQL)

| RPC | Usage |
|-----|-------|
| `match_chunks(query_embedding, match_count, match_threshold)` | Recherche vectorielle EN (cosinus) |
| `match_chunks_fr(...)` | Recherche vectorielle FR |
| `search_chunks_fts(query_text, match_count)` | Recherche FTS EN |
| `search_chunks_fts_fr(...)` | Recherche FTS FR |

### Migrations (ordre chronologique)

```
20260204100000_enable_pgvector.sql
20260204100001_sources.sql
20260204100002_documents.sql
20260204100003_chunks.sql
20260204100004_veille.sql
20260204100005_rls.sql
20260204100006_chunks_embedding_384.sql
20260205100000_documents_ingestion_log.sql
20260205100001_match_chunks_rpc.sql
20260205100002_conversations_messages.sql
20260205100003_rag_settings.sql
20260205100004_search_chunks_fts.sql
20260205100005_rag_settings_hybrid.sql
20260206100000_chunks_bilingue_fr.sql
20260207100000_sources_rss.sql
20260504100000_sources_active.sql
```

---

## Clients Supabase

| Fichier | Type | Quand l'utiliser |
|---------|------|-----------------|
| `lib/supabase/client.ts` | Browser | Composants React client (`'use client'`) |
| `lib/supabase/server.ts` | Server (cookies) | API routes standard (respecte RLS) |
| `lib/supabase/admin.ts` | Service role | Cron + ingestion uniquement (bypasse RLS) |

---

## Pipeline RAG — flux technique

```
POST /api/rag/chat
    │
    ├── detect-lang.ts → 'fr' | 'en'
    ├── settings.ts → rag_settings (seuils, poids, k)
    ├── embed.ts → queryEmbedding (Xenova, 384D)
    │
    ├── search.ts
    │     ├── match_chunks[_fr]     (vector cosinus)
    │     ├── search_chunks_fts[_fr] (FTS)
    │     └── RRF fusion → top-K chunks
    │
    ├── GARDE-FOU : bestSimilarity < threshold ?
    │     └── OUI → retourner guard_message (pas d'appel OpenAI)
    │
    ├── openai.ts → gpt-4o-mini (streaming SSE)
    │     ├── contexte : chunks (content ou content_fr selon lang)
    │     ├── historique : N derniers messages
    │     └── instruction langue : "Réponds en français" / "en anglais"
    │
    ├── citations.ts → [1], [2]... avec doc info
    └── conversation-persistence.ts → insert messages + update conversation
```

---

## Pipeline Veille — flux technique

```
POST /api/veille/scrape (ou GET /api/cron/veille)
    │
    ├── createRun() → veille_runs (status=running)
    ├── getKnownDois() → déduplication
    │
    ├── Sources RSS (43+ journaux, filtre active=true)
    │     ├── fetchRssFeed() → titre, DOI, abstract, auteurs, date
    │     ├── Filtre éditorial (corrections, errata, rétractations)
    │     ├── Filtre 7 jours
    │     ├── Dédup par DOI
    │     ├── OpenAlex batch (abstracts manquants + filtre type:article)
    │     │     └── is_final=false → skip (preprint, book-chapter, etc.)
    │     └── Lookup DOI individuel (articles sans DOI, ex. Elsevier)
    │
    ├── Sources OpenAlex (MDPI et similaires, filtre active=true)
    │     ├── fetchRecentByIssn(issn, 7, filter=type:article)
    │     └── is_final=false → skip
    │
    ├── insertVeilleItemsWithIds() → batch 50
    ├── scoreVeilleItems() → embed abstract → match_chunks → similarity_score
    └── completeRun(runId, 'completed'|'failed')
```

**Garde-fous publications finales :**
- Filtre `active=true` sur les sources → seules les sources activées entrent dans le pipeline
- Filtre éditorial sur le titre (corrections, errata, rétractations) dans `fetch-rss.ts`
- Filtre `type:article` OpenAlex (côté API) → preprints et chapitres de livres exclus
- Vérification `is_final` côté pipeline (double protection)

---

## Pipeline Ingestion PDF (Python)

```
scripts/ingest.py
    │
    ├── Skip si storage_path déjà en base avec status=done
    ├── Suppression + ré-ingestion si status=error ou processing
    │
    ├── PyMuPDF → extraction texte par page
    │     └── OCR Tesseract si < 50 chars/page (PDF scannés)
    │
    ├── Chunking → CHUNK_SIZE=600, CHUNK_OVERLAP=100 (par sections)
    ├── sentence-transformers → embedding EN (384D)
    ├── MarianMT (Helsinki-NLP/opus-mt-en-fr) → traduction EN→FR
    ├── sentence-transformers → embedding FR (384D)
    └── Supabase → insert chunks (content, embedding, content_fr, embedding_fr)
                   Triggers → content_tsv, content_fr_tsv (automatique)
```

---

## Déploiement Vercel

| Configuration | Détail |
|--------------|--------|
| Cron rétention | `0 4 * * *` → `GET /api/cron/retention` (supprime conversations > 30j) |
| Cron veille | `0 6 * * *` → `GET /api/cron/veille` (pipeline veille quotidienne) |
| maxDuration | 300s sur `/api/cron/veille` (pipeline longue) |
| Auth crons | `Authorization: Bearer $CRON_SECRET` (envoyé automatiquement par Vercel) |

---

## Références
- `documentation/SCHEMA_DB_ET_DONNEES.md` — schéma DB détaillé + flows numérotés
- `documentation/STRUCTURE_ET_ARCHITECTURE.md` — arborescence complète
- `documentation/BACK_RAG.md` — spécifications API RAG complètes
- `documentation/PIPELINE_VEILLE_CONSOLIDE.md` — pipeline veille détaillée
