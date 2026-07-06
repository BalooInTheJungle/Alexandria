# Stack et technologies — Alexandria

**Rôle** : document de référence des **technologies utilisées** dans le projet et de **leur usage** (où et pourquoi).

> Réécrit le 06/07/2026. Changements principaux : plus de traduction FR (MarianMT abandonné), l'index vectoriel utilisé en production est **IVFFlat** (pas HNSW comme le déclarent encore les migrations d'origine), la veille utilise **RSS + OpenAlex + CrossRef** (pas de scraping HTML + LLM), et il existe **3 chemins d'ingestion** PDF (pas 2).

---

## 1. Vue d'ensemble

- **Front et API** : Next.js 14 (App Router, React, TypeScript), hébergé sur Vercel.
- **Données et auth** : Supabase (Postgres, pgvector, FTS, Auth, Storage bucket `analyses`).
- **RAG** : embeddings locaux (Xenova, pas d'API payante pour l'embedding) ; génération des réponses via API OpenAI (`gpt-4o-mini`).
- **Ingestion PDF** : 3 chemins — script Python bulk, upload API corpus direct, upload API module Analyse (temporaire).
- **Veille** : RSS (44 sources nominales + 2 orphelines cassées) + OpenAlex (2, MDPI) + CrossRef pour la finalisation + Semantic Scholar (1), soit 49 sources actives au total, orchestrée par des scripts Node.js tournant dans **GitHub Actions** (pas sur Vercel).

---

## 2. Front et serveur (Next.js)

| Technologie | Version / détail | Rôle dans le projet |
|-------------|------------------|----------------------|
| **Next.js** | 14.x (App Router) | Application web : Bibliographie, Analyse, Database, routing, rendu serveur. |
| **React** | 18.x | Composants UI. |
| **TypeScript** | 5.x | Typage du code (app, lib, API, scripts). |
| **API Routes** (Next) | — | `/api/rag/*`, `/api/veille/*`, `/api/analyse/*`, `/api/corpus/*`, `/api/documents/*`, `/api/cron/*`. |
| **@vercel/functions** (`waitUntil`) | — | Utilisé par le chemin **legacy** de la veille (`lib/veille/pipeline.ts`) et par les routes Analyse tournant en arrière-plan. Contraintes fortes en usage réel (voir `PIPELINE_VEILLE_CONSOLIDE.md` §7). |

---

## 3. Base de données (Supabase)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **Supabase** | Postgres + Auth + Storage (bucket `analyses` pour les PDF du module Analyse). |
| **Postgres** | Tables principales : `documents`, `chunks`, `sources`, `veille_runs`, `veille_items`, `conversations`, `messages`, `rag_settings`, `document_analyses`, `query_logs`, `ss_representative_papers`. Voir `SCHEMA_DB_ET_DONNEES.md`. |
| **pgvector** | Extension pour les embeddings (`vector(384)`) dans `chunks.embedding`. Index **IVFFlat** (`lists=100`) en production — reconstruit après chaque ingestion bulk via `psql` direct (pas le SQL Editor, timeout HTTP 30s). Les migrations d'origine (`20260204100003_chunks.sql`, `20260204100006_...`, `20260206100000_...`) créent un index **HNSW** ; le passage à IVFFlat a été fait manuellement en exploitation (pas de migration `DROP`/`CREATE` correspondante trouvée) — à vérifier en base avant de citer le type d'index exact dans le mémoire. |
| **FTS (tsvector + GIN)** | `chunks.content_tsv` (config `english`). Colonnes FR (`content_fr_tsv`) toujours présentes mais non alimentées (legacy). |
| **Supabase Auth** | Login email/mot de passe, session, RLS sur toutes les tables. |
| **Supabase JS** | `@supabase/supabase-js` + `@supabase/ssr` (client navigateur/serveur), utilisé aussi en Node pur (sans Next.js) dans les scripts `scripts/veille/*.ts`. |

---

## 4. RAG : embeddings, recherche, génération

### 4.1 Embeddings (recherche + ingestion Node)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **@xenova/transformers** | Modèle **Xenova/all-MiniLM-L6-v2** côté Node (384D), utilisé pour : (1) embedder la requête utilisateur (`lib/rag/embed.ts`), (2) embedder les chunks à l'ingestion API (`/api/documents/upload`, `/api/analyse/upload`), (3) embedder les abstracts de la veille (`lib/veille/score.ts`, découpés en chunks ~150 mots). Sur Vercel (filesystem lecture seule), le cache du modèle est redirigé vers `/tmp`. |

### 4.2 Embeddings (ingestion bulk Python)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **sentence-transformers** (Python) | Modèle **all-MiniLM-L6-v2** dans `scripts/ingest.py`, même dimension (384D) que côté Node — cohérence indispensable pour que la recherche fonctionne sur tout le corpus. |
| ~~Traduction MarianMT~~ | **Abandonnée.** Aucune trace de `Helsinki-NLP/opus-mt-en-fr` ni de `MarianMTModel` dans `scripts/ingest.py` actuel — le corpus est indexé en anglais uniquement. |

### 4.3 Recherche (FTS + vector + RRF)

| Élément | Technologie / mise en œuvre | Rôle |
|---------|-----------------------------|------|
| **Vector** | RPC `match_chunks` (corpus, exclut `is_temp=true`) et `match_author_chunks` (articles auteur uniquement) — similarité cosinus. | Chunks les plus proches sémantiquement. |
| **FTS** | RPC `search_chunks_fts` (`content_tsv`, config `english`) — pas de variante `_fr` appelée en pratique. | Recherche lexicale. |
| **Fusion** | RRF (Reciprocal Rank Fusion) dans `lib/rag/search.ts`, paramètres `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k` (`rag_settings`). | Top-K unique pour le LLM et le garde-fou. |

### 4.4 Génération des réponses

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **OpenAI API** | `gpt-4o-mini` (Chat Completions) pour le chat RAG (onglet Discussion du module Analyse) **et** pour les analyses veille (`ai_analysis`, `ai_summary`). Toujours appelé via `fetch` natif dans les scripts (jamais le SDK `openai`, incompatible avec `waitUntil` — voir `PIPELINE_VEILLE_CONSOLIDE.md` §7). |
| **Streaming** | SSE côté chat (`/api/rag/chat`, `/api/analyse/[id]/chat`) ; les scripts veille (recap-articles, recap-global) n'utilisent pas de streaming (appel bloquant, réponse JSON). |

---

## 5. Ingestion des PDF (3 chemins, pas 2)

### 5.1 `POST /api/documents/upload` — corpus direct (page Database)

| Technologie | Rôle |
|-------------|------|
| **pdf-parse** | Extraction texte depuis un buffer (Node), pas d'OCR. |
| **lib/ingestion/** | parse → chunk (~400 car., overlap 50) → embed (Xenova) → insert `documents`+`chunks` (`is_temp=false`). Dédup par DOI. |
| **Supabase** | Insert direct ; PDF non conservé (traité en mémoire). |

### 5.2 `POST /api/analyse/upload` — module Analyse (temporaire)

| Technologie | Rôle |
|-------------|------|
| **lib/ingestion/** (mêmes modules) | Même parsing/chunking, mais écrit dans `document_analyses` + `chunks` avec `is_temp=true`. Devient permanent seulement après clic "Intégrer au corpus". |
| **Supabase Storage (bucket `analyses`)** | Conserve le PDF uploadé (contrairement au chemin 5.1). |

### 5.3 `scripts/ingest.py` — ingestion bulk

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **PyMuPDF (fitz)** | Extraction texte par page depuis `data/pdfs2/YEAR/` (organisation par année de **publication**). |
| **Tesseract (pytesseract) + pdf2image** | Fallback OCR si texte < 50 caractères/page. Nécessite Poppler + Tesseract installés au niveau système. |
| **sentence-transformers** | Embeddings EN (384D). **Pas de traduction, pas d'embedding_fr écrit.** |
| **Supabase (client Python)** | Insert `documents`/`chunks` par batch (`INSERT_BATCH=50`), rebuild automatique de l'index vectoriel en fin de run. |
| **python-dotenv** | Chargement `.env.local` sans lancer Next.js. |

---

## 6. Veille (RSS + APIs scientifiques, pas de scraping HTML)

| Technologie | Rôle réel |
|-------------|------------------|
| **Flux RSS/Atom** | Parsing des sources actives de type `rss` (46 en base dont 2 non fonctionnelles, `lib/veille/fetch-rss.ts`) — pas de navigateur headless, pas de scraping HTML de pages listing. |
| **OpenAlex API** | Enrichissement batch des abstracts par DOI, vérification `is_final` (publication finalisée vs preprint/ASAP), fetch direct par ISSN pour les sources sans RSS fiable (MDPI). |
| **CrossRef API** | Fallback de vérification `is_final` quand OpenAlex ne confirme pas. |
| **Semantic Scholar API** | Source de recommandations optionnelle (Job 1b), basée sur les articles auteur représentatifs (`ss_representative_papers`). |
| **Dédup** | DOI uniquement — index unique en base (`idx_veille_items_doi_unique`), pas de fuzzy matching sur titre. |
| **Embeddings + similarité** | Abstract découpé en chunks ~150 mots (Xenova), `match_chunks`/`match_author_chunks` en parallèle → `similarity_score`/`author_score`. **Implémenté et actif**, pas "à terme" comme le disait l'ancienne version de ce document. |
| **GitHub Actions** | Runtime d'exécution des 4 jobs quotidiens (`scripts/veille/*.ts`) — pas de scraping ni de logique lourde côté Vercel. |

---

## 7. Synthèse : techno → usage

| Techno | Où | Usage |
|--------|-----|-------|
| Next.js + React + TS | Front + API | App web, routes API |
| Supabase (Postgres, Auth, Storage) | Back / DB | Données, auth, RPC, stockage PDF Analyse |
| pgvector (IVFFlat) | DB | Similarité vectorielle sur les chunks |
| FTS (tsvector, GIN, english) | DB | Recherche lexicale |
| Xenova/transformers | Node (API + scripts veille) | Embedding requête, upload API, abstracts veille |
| sentence-transformers | Script Python | Embedding des chunks à l'ingestion bulk |
| OpenAI (`gpt-4o-mini`) | Node (fetch natif) | Chat RAG, analyses veille (individuelle + globale) |
| PyMuPDF + Tesseract/pdf2image | Script Python | Extraction texte + OCR |
| RRF | `lib/rag/search.ts` | Fusion FTS + vector |
| RSS + OpenAlex + CrossRef + Semantic Scholar | GitHub Actions (`scripts/veille/*.ts`) | Extraction et finalisation des articles de veille |
| `rag_settings` (table) | DB + API | Paramétrage dynamique du chat |

---

## 8. Références

| Document | Contenu |
|----------|---------|
| `BACK_RAG.md` | API, ingestion, garde-fou, paramétrage (détail back) |
| `FONCTIONNALITES_FRONT.md` | UI Bibliographie / Analyse / Database |
| `PIPELINE_VEILLE_CONSOLIDE.md` | Pipeline veille complet |
| `SCHEMA_DB_ET_DONNEES.md` | Tables, migrations |
