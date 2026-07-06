# Schéma DB et données — Alexandria

**Rôle** : référence des **tables Supabase**, du **tableau des migrations** et des **flows** entre le back et la base de données.

> Réécrit le 06/07/2026 : la version précédente décrivait un schéma à 15 migrations avec un système bilingue FR/EN actif au niveau recherche. Le schéma réel compte aujourd'hui **52 migrations** ; le bilingue FR est **legacy** (colonnes conservées, plus utilisées en recherche), et le module **Analyse** (upload PDF individuel) a ajouté plusieurs tables/colonnes absentes de l'ancienne version.

---

## Appliquer les migrations (CLI)

1. **Récupérer le project ref** : Dashboard Supabase → Settings → General → Reference ID.
2. **Lier le projet** (une fois) : `npx supabase link --project-ref <REF>`.
3. **Pousser les migrations** : `npx supabase db push`.

Pour les opérations longues (rebuild d'index), utiliser **psql en direct**, jamais le SQL Editor (timeout HTTP 30s) — voir `CLAUDE.md`.

---

## 1. Extension

- **vector** (pgvector) : stockage et recherche des embeddings (colonnes `vector(384)`).

---

## 2. Tables

### 2.1 `public.sources`

49 sources de veille actives, 100 % en base (44 RSS "nominales" + 2 RSS orphelines non fonctionnelles + 2 OpenAlex/MDPI + 1 Semantic Scholar — détail vérifié dans `documentation/SOURCES_JOURNAUX.md`).

| Colonne          | Type         | Description                                      |
|------------------|--------------|--------------------------------------------------|
| id               | uuid (PK)    |                                                  |
| url              | text         | URL homepage / endpoint                          |
| name             | text         | Nom de la source                                 |
| publisher        | text         | Éditeur (ACS, RSC, Wiley, Nature, APS, Allen Institute for AI…) |
| issn             | text         | ISSN électronique (unique)                       |
| rss_url          | text         | URL du flux RSS (si `source_type = rss`)         |
| source_type      | text         | `rss` \| `openalex` \| `semantic_scholar`        |
| fetch_strategy   | text         | `auto` \| `fetch` \| `rss` \| `browser` (Playwright, anti-bot) |
| active           | boolean      | `true` = incluse dans le pipeline veille          |
| created_at       | timestamptz  |                                                  |
| last_checked_at  | timestamptz  | Dernier run veille                               |

**Peuplement** : `scripts/import-sources.ts`. La source `semantic_scholar` est insérée par migration (`20260616100000_sources_semantic_scholar.sql`), activée en pipeline via la variable repo GitHub `ENABLE_SEMANTIC_SCHOLAR=true` (Job 1b).

---

### 2.2 `public.documents`

Métadonnées des PDF du corpus.

| Colonne             | Type         | Description                                        |
|---------------------|--------------|-----------------------------------------------------|
| id                  | uuid (PK)    |                                                    |
| title               | text         |                                                    |
| authors             | text[]       |                                                    |
| doi                 | text         |                                                    |
| journal             | text         |                                                    |
| published_at        | date         |                                                    |
| storage_path        | text         | Chemin relatif (ex. `data/pdfs2/2024/nom.pdf`)     |
| status              | text         | pending \| processing \| done \| error             |
| error_message       | text         | Si status = error                                  |
| ingestion_log       | jsonb        | chunks_count, ocr_pages_count, ingested_at, error  |
| **is_author_article** | boolean    | `true` = article publié par le chercheur (`data/Articles auteur/`), vs corpus général |
| created_at          | timestamptz  |                                                    |
| updated_at          | timestamptz  |                                                    |

**Index** : `documents(doi)`, `documents(status)`, index partiel sur `is_author_article = true`.

---

### 2.3 `public.chunks`

Segments de documents (FTS + vector).

| Colonne         | Type           | Description                                |
|-----------------|----------------|--------------------------------------------|
| id              | uuid (PK)      |                                            |
| document_id     | uuid (FK)      | → documents.id                             |
| content         | text           | Texte du chunk (EN, original)              |
| position        | int            | Ordre dans le document                     |
| page            | int            | Numéro de page (optionnel)                 |
| section_title   | text           | Ex. "Introduction" (optionnel)              |
| embedding       | vector(384)    | Embedding EN (all-MiniLM-L6-v2)            |
| content_tsv     | tsvector       | FTS anglais, maintenu par trigger          |
| umap_x, umap_y  | float          | Coordonnées UMAP 2D (calculées offline par `compute_umap.py`) |
| **analysis_id** | uuid (FK)      | → document_analyses.id, si chunk issu d'un upload Analyse |
| **is_temp**     | boolean        | `true` = chunk d'une analyse **pas encore intégrée** au corpus (exclu du scoring, voir plus bas) |
| content_fr, embedding_fr, content_fr_tsv | text/vector(384)/tsvector | **Legacy** — colonnes bilingues FR conservées en base mais **plus alimentées ni interrogées** depuis que `scripts/ingest.py` ne traduit plus (voir §7) |
| created_at      | timestamptz    |                                            |

**Index** : GIN sur `content_tsv`, IVFFlat (`lists=100`) sur `embedding` (rebuild après chaque ingestion bulk > 50k chunks).

**RPC actives** :
- `match_chunks(query_embedding, match_threshold, match_count)` — recherche vectorielle sur le corpus. **Exclut `is_temp=true`** depuis la migration `20260626100000_match_chunks_exclude_temp.sql` (sinon un document uploadé en Analyse matchait artificiellement contre ses propres chunks temporaires).
- `match_author_chunks(query_embedding, match_threshold, match_count)` — même principe mais restreint à `documents.is_author_article = true`. Utilisé pour `author_score` (veille) et le score auteur du module Analyse.
- `search_chunks_fts(query, match_count)` — FTS anglais.
- `match_chunks_fr` / `search_chunks_fts_fr` — **legacy**, toujours définies en base mais non appelées par `lib/rag/search.ts` (pas de détection de langue ni de pipeline FR côté recherche actuellement).

---

### 2.4 `public.veille_runs`

Une run = les sources actives traitées en une exécution GitHub Actions (7h UTC) — voir `documentation/SOURCES_JOURNAUX.md` pour le décompte réel (49 actives, dont 2 RSS non fonctionnelles).

| Colonne           | Type         | Description                                                    |
|-------------------|--------------|------------------------------------------------------------------|
| id                | uuid (PK)    |                                                                |
| status            | text         | pending \| running \| completed \| failed \| stopped           |
| phase             | text         | Phase en cours (extract \| score \| recap \| done)              |
| started_at, completed_at | timestamptz |                                                          |
| error_message     | text         | Si échec global                                                |
| items_processed / items_total | int | Suivi de progression du scoring                          |
| abort_requested   | boolean      | Arrêt manuel demandé                                            |
| **pipeline_logs** | jsonb        | Logs consolidés des 4 jobs (+ préfixe `ss/` pour le Job 1b Semantic Scholar) |
| ai_summary        | jsonb        | `{ themes: string[], synthesis: string }` généré par GPT-4o-mini (Job 4) |
| high_score_count  | int          | Nombre d'articles avec `similarity_score` ≥ `score_threshold`  |
| score_threshold   | real         | **Défaut colonne : 0.65** — mais le code applique **0.75** partout en pratique (voir §7) |

---

### 2.5 `public.veille_items`

Un article détecté par un run.

| Colonne          | Type         | Description                |
|------------------|--------------|-----------------------------|
| id               | uuid (PK)    |                            |
| run_id, source_id | uuid (FK)   | → veille_runs.id, sources.id |
| url, title, authors, doi, abstract, published_at | | Métadonnées article |
| similarity_score | real         | Top-1 similarité embedding abstract vs **corpus complet** (`match_chunks`) |
| **author_score** | float        | Top-1 similarité vs **articles auteur uniquement** (`match_author_chunks`), NULL si pas encore calculé |
| heuristic_score  | real         | Radicaux corpus trouvés dans l'abstract (informatif, pas utilisé pour le seuil d'affichage) |
| **corpus_refs**  | jsonb        | `[{doc_title, excerpt, page, similarity}]` — passages corpus ≥75% ayant déclenché le score |
| **ai_analysis**  | jsonb        | `{ contribution, relevance, corpus_link }` — rempli uniquement pour les articles ≥75% (Job 3) |
| **is_relevant**  | boolean      | Feedback manuel chercheur : `NULL` = non évalué, `true`/`false` |
| **read_at**      | timestamptz  | Marque lu/non lu (toggle front) |
| last_error       | text         | Log en cas d'échec de scoring |
| created_at       | timestamptz  |                            |

**Contrainte** : index unique sur `doi` (NULLs exclus) — un seul item par DOI, dédup au niveau DB.
**Index** : `run_id`, `source_id`, `doi`, `url`, `read_at` (partiel non-null), `ai_analysis` (partiel non-null), `is_relevant` (partiel non-null).

---

### 2.6 `public.veille_run_urls`

Table intermédiaire pour le traitement par lots des URLs candidates au sein d'un run (queue de travail interne au Job 1/2, pas exposée au front).

| Colonne     | Type      | Description                    |
|-------------|-----------|---------------------------------|
| id          | uuid (PK) |                                |
| run_id      | uuid (FK) | → veille_runs.id               |
| source_id   | uuid (FK) | → sources.id                   |

---

### 2.7 `public.conversations` / `public.messages`

Fil de conversation du chat RAG (réutilisé par le module Analyse). Rétention 30 jours (`api/cron/retention`).

**conversations** : id, title, created_at, updated_at.
**messages** : id, conversation_id (FK), role (`user`/`assistant`), content, sources (jsonb, citations), created_at.

---

### 2.8 `public.rag_settings`

Paramètres RAG modifiables, relus à **chaque requête chat**.

Clés : `context_turns`, `similarity_threshold`, `use_similarity_guard`, `guard_message`, `match_count`, `match_threshold`, `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k`.

---

### 2.9 `public.query_logs`

Log de chaque requête posée au chat RAG (analytique, pas de RGPD sensible car pas d'identité liée — pas d'auth publique sur ce projet).

| Colonne | Type | Description |
|---|---|---|
| id | uuid (PK) | |
| query_text | text | |
| lang | text | `fr` \| `en` |
| chunks_retrieved | int | |
| best_similarity | float | |
| was_guardrailed | boolean | |
| conversation_id | uuid (FK) | → conversations.id |
| created_at | timestamptz | |

**RPC** : `get_query_stats_daily(days_back)` — stats agrégées par jour (heatmap `/database`).

---

### 2.10 `public.document_analyses`

Table principale du module **Analyse** (upload PDF individuel, distinct du corpus bulk).

| Colonne       | Type        | Description |
|---------------|-------------|-------------|
| id            | uuid (PK)   | |
| user_id       | uuid (FK)   | → auth.users.id |
| document_id   | uuid (FK)   | → documents.id (nullable) |
| title, doi, ss_paper_id | text | |
| status        | text        | pending \| processing \| completed \| error |
| summary       | jsonb       | `{ intro, methods, results, discussion, tldr }` |
| corpus_refs   | jsonb       | `[{ doc_title, excerpt, page, similarity }]` |
| cited_refs    | jsonb       | `[{ raw, doi, in_corpus, ss_metadata?, corpus_similarity? }]` |
| ss_recs       | jsonb       | `[{ title, authors, year, doi, abstract, similarity_score }]` |
| **author_score** | float    | Similarité vs articles auteur (même logique que `veille_items.author_score`) |
| is_integrated | boolean     | `true` après clic "intégrer au corpus" (`is_temp=false` sur les chunks liés) |
| expires_at    | timestamptz | now() + 7 jours (nettoyage des analyses non intégrées) |
| created_at, updated_at | timestamptz | |

RLS : chaque utilisateur ne voit/modifie que ses propres analyses (`auth.uid() = user_id`).

---

### 2.11 `public.ss_representative_papers`

Cache des titres d'articles auteur les plus représentatifs (centroïde des embeddings), recalculé manuellement par `compute-ss-representatives.ts` après chaque `ingest.py --author`. Sert de base au Job 1b (recommandations Semantic Scholar).

| Colonne | Type | Description |
|---|---|---|
| id | uuid (PK) | |
| title | text | |
| distance | float | Distance au centroïde |
| ss_paper_id | text | paperId Semantic Scholar résolu (NULL si non trouvé) |
| computed_at | timestamptz | |

---

### 2.12 `public.corpus_top_terms_cache`

Cache des termes les plus fréquents du corpus (`ts_stat` sur `content_tsv`), pour éviter le timeout Supabase sur `get_corpus_top_terms` (35k+ chunks). Peuplé manuellement/cron, lu par la RPC.

---

## 3. Tableau des migrations (52)

| Fichier | Objectif |
|---|---|
| 20260204100000_enable_pgvector | Activer pgvector |
| 20260204100001_sources | Table sources |
| 20260204100002_documents | Table documents |
| 20260204100003_chunks | Table chunks + trigger FTS EN |
| 20260204100004_veille | Tables veille_runs, veille_items |
| 20260204100005_rls | Politiques RLS de base |
| 20260204100006_chunks_embedding_384 | Dimension embedding 384D |
| 20260205100000_documents_ingestion_log | Colonne ingestion_log |
| 20260205100001_match_chunks_rpc | RPC match_chunks |
| 20260205100002_conversations_messages | Tables conversations, messages |
| 20260205100003_rag_settings | Table rag_settings |
| 20260205100004_search_chunks_fts | RPC search_chunks_fts |
| 20260205100005_rag_settings_hybrid | Clés hybride (fts/vector weight, rrf_k, hybrid_top_k) |
| 20260206100000_chunks_bilingue_fr | Colonnes FR (**legacy**, non utilisées aujourd'hui) |
| 20260207100000_sources_rss | Colonnes RSS sur sources, stratégie RSS |
| 20260209100000_rag_settings_use_similarity_guard | Clé use_similarity_guard |
| 20260209100001_rag_settings_insert_policy | Policy INSERT sur rag_settings |
| 20260211100000_veille_heuristic_score_and_sources_delete | Colonne heuristic_score + policy DELETE sources |
| 20260212100000_sources_fetch_strategy | Colonne fetch_strategy (auto/fetch/rss/browser) |
| 20260213100000_veille_runs_with_counts_rpc | RPC get_veille_runs_with_counts |
| 20260223100000_corpus_top_terms_rpc | RPC get_corpus_top_terms |
| 20260225100000_veille_stop_support | Statut stopped + abort_requested |
| 20260226100000_veille_runs_progress | Colonnes phase, items_processed, items_total |
| 20260226100001_corpus_top_terms_aliases | Fix alias RPC get_corpus_top_terms |
| 20260227100000_corpus_top_terms_timeout | Fix timeout RPC (plpgsql volatile) |
| 20260227100001_corpus_terms_cache | Table cache corpus_top_terms_cache |
| 20260228100000_veille_run_urls | Table veille_run_urls (queue par lots) |
| 20260504100000_sources_active | Colonne active sur sources |
| 20260504110000_veille_run_summary | Colonnes ai_summary, high_score_count, score_threshold |
| 20260505120000_veille_items_corpus_refs | Colonne corpus_refs |
| 20260505130000_query_logs | Table query_logs + RPC get_query_stats_daily |
| 20260505140000_chunks_umap | Colonnes umap_x, umap_y |
| 20260526100000_documents_author_flag | Colonne is_author_article |
| 20260526110000_match_corpus_by_author_doc | RPC liée à la comparaison auteur/corpus |
| 20260526120000_match_corpus_docs_rpc | RPC comparaison documents |
| 20260529100000_veille_run_logs | Colonne pipeline_logs sur veille_runs |
| 20260603100000_corpus_stats_rpcs | RPCs stats corpus (page Database) |
| 20260603110000_corpus_stats_indexes | Index supportant les RPCs stats |
| 20260603120000_veille_items_run_id_index | Index run_id sur veille_items |
| 20260603130000_veille_items_read_at | Colonne read_at |
| 20260603140000_veille_items_ai_analysis | Colonne ai_analysis |
| 20260608100000_veille_items_doi_unique | Dédup + index unique DOI |
| 20260616100000_sources_semantic_scholar | source_type='semantic_scholar' + insertion source |
| 20260616110000_rpc_author_representative_titles | RPC titres représentatifs auteur (v1) |
| 20260616120000_ss_representative_papers | Table ss_representative_papers |
| 20260616130000_rpc_author_representative_titles_v2 | RPC titres représentatifs auteur (v2) |
| 20260617100000_document_analyses | Table document_analyses + colonnes chunks.analysis_id/is_temp |
| 20260623100000_veille_author_score | Colonne author_score sur veille_items |
| 20260623110000_match_author_chunks_rpc | RPC match_author_chunks |
| 20260623120000_document_analyses_author_score | Colonne author_score sur document_analyses |
| 20260626100000_match_chunks_exclude_temp | match_chunks exclut is_temp=true |
| 20260626110000_veille_items_is_relevant | Colonne is_relevant (feedback chercheur) |

**Rétention 30 jours** : `GET /api/cron/retention` (cron Vercel, 4h UTC) supprime `conversations` (cascade `messages`) où `updated_at` < now() - 30 jours.

---

## 4. Flows back ↔ DB principaux

### 4.1 Veille (automatique, GitHub Actions, 7h UTC)
1. **Job 1** `extract.ts` : lit `sources` (active=true) → fetch RSS/OpenAlex → filtre finalisation (OpenAlex batch + CrossRef) → insert `veille_items` par lots de 50, crée `veille_runs` (status=running).
2. **Job 1b** (optionnel) `extract-semanticscholar.ts` : lit `ss_representative_papers` → appelle l'API SS → insert `veille_items` (source_type=semantic_scholar).
3. **Job 2** `score.ts` : pour chaque item sans `similarity_score` → embed abstract → `match_chunks` + `match_author_chunks` en parallèle → écrit `similarity_score`, `author_score`, `corpus_refs`.
4. **Job 3** `recap-articles.ts` : items `similarity_score ≥ 0.75` → GPT-4o-mini → `ai_analysis`.
5. **Job 4** `recap-global.ts` : items avec `ai_analysis` non-null → GPT-4o-mini → fusionne en `veille_runs.ai_summary`, marque `status=completed`.
6. Front (`/bibliographie`) lit uniquement (aucune écriture) via `/api/veille/*`.

### 4.2 Analyse (upload PDF utilisateur)
1. `POST /api/analyse/upload` → parse/chunk/embed → insert `document_analyses` (status=ready) + `chunks` (`analysis_id`, `is_temp=true`).
2. `GET /api/analyse/[id]/insights` → calcul parallèle : résumé GPT (`summary`), `corpus_refs` (`match_chunks`, qui **exclut** les chunks `is_temp`), `author_score` (`match_author_chunks`), `cited_refs` (Semantic Scholar), `ss_recs` → écrit dans `document_analyses`.
3. `POST /api/analyse/[id]/chat` → SSE, réutilise `lib/rag/search.ts` (chunks du doc + corpus) + insère `conversations`/`messages`.
4. `POST /api/analyse/[id]/integrate` → `chunks.is_temp = false`, `document_analyses.is_integrated = true`.

### 4.3 Ingestion bulk (script Python)
1. `scripts/ingest.py` lit `data/pdfs2/YEAR/` (ou `data/Articles auteur/` avec `--author`).
2. Dédup par DOI puis storage_path → insert `documents` (status=processing).
3. Parse (PyMuPDF + OCR fallback), chunk, embed (Xenova, **sans traduction FR**) → insert `chunks`.
4. Met à jour `documents` (status=done, ingestion_log) ; rebuild IVFFlat automatique en fin de script.

### 4.4 Chat RAG (réutilisé par Analyse)
1. Lecture `rag_settings` à chaque requête.
2. Embedding requête → `match_chunks` (+ `search_chunks_fts` si hybride activé) → fusion RRF.
3. Si similarité < seuil et garde-fou actif → réponse guard_message, pas d'appel LLM.
4. Sinon appel LLM en stream → insert `messages` + update `conversations.updated_at` + insert `query_logs`.

---

## 5. RLS

Toutes les tables sont en RLS. Écritures veille/ingestion/cron : **client admin** (service role) uniquement. `document_analyses` : policy stricte par `user_id`. `conversations`/`messages`/`rag_settings` : utilisateur authentifié.

---

## 6. Références

| Document | Contenu |
|---|---|
| `STRUCTURE_ET_ARCHITECTURE.md` | Vue d'ensemble modules et dossiers |
| `PIPELINE_VEILLE_CONSOLIDE.md` | Détail du pipeline veille |
| `BACK_RAG.md` | Détail API RAG (chat, search, settings) |
| `CLAUDE.md` | Seuils, commandes, état d'avancement à jour |

---

## 7. Points de vigilance (pour le mémoire)

- **Bilingue FR** : les colonnes `content_fr`, `embedding_fr`, `content_fr_tsv` et les RPC `match_chunks_fr`/`search_chunks_fts_fr` existent toujours en base (aucune migration `DROP COLUMN` trouvée), mais **plus aucun code applicatif ne les alimente ou ne les interroge** — `scripts/ingest.py` n'effectue plus de traduction, et `lib/rag/search.ts` ne fait pas de détection de langue. Un plan de nettoyage (`docs/PLAN_CLEAN_FR.md`, mentionné en mémoire de session) prévoyait de les supprimer pour libérer de l'espace DB (limite Supabase Pro ~8 Go) ; **à vérifier en base si ce nettoyage a été exécuté manuellement** (pas de trace en migration).
- **Seuil 75%** : la colonne `veille_runs.score_threshold` a un défaut DB de **0.65**, mais **tout le code applicatif** (`score.ts`, `pipeline.ts`, `summarize.ts`, `recap-articles.ts`, `recap-global.ts`, routes API) utilise **0.75** en constante hardcodée. Le défaut DB est donc trompeur / non représentatif du comportement réel — à corriger ou au moins à mentionner si le mémoire cite ce champ.
