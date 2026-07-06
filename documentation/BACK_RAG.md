# Back RAG — API, ingestion, génération, paramétrage, conversation

**Rôle** : référence consolidée du **côté back** du RAG : ce qui est en place, par thème.

> Réécrit le 06/07/2026. Le changement le plus important par rapport à l'ancienne version : **le pipeline bilingue FR/EN a été abandonné**. Il n'y a plus de détection de langue, plus de colonnes FR actives, plus de RPC `_fr` appelées. La recherche est **monolingue anglaise** (embeddings EN uniquement) ; c'est le LLM qui reçoit l'instruction générique "réponds dans la langue de la question" et gère la traduction à la volée. Ce module RAG (`lib/rag/`, `app/api/rag/`) est aujourd'hui **réutilisé par le module Analyse** — il n'a plus de page dédiée dans le dashboard (`/rag` retirée en juin 2026).

---

## 1. Récapitulatif par thème

| Thème | État réel |
|-------|------|
| **Recherche hybride (FTS + vector + RRF)** | FTS anglais + vector EN + fusion RRF. Une seule paire de RPC (`match_chunks`, `search_chunks_fts`), pas de variante `_fr` appelée. |
| **API Chat** | `POST /api/rag/chat` ; garde-fou configurable ; N derniers messages ; persistance ; streaming SSE ; log analytique (`query_logs`). |
| **Garde-fou hors domaine** | Activable/désactivable (`use_similarity_guard`) ; seuil (`similarity_threshold`) ; message (`guard_message`) ; **mode "connaissances générales"** si le garde-fou est désactivé et qu'aucun chunk n'est assez proche (voir §2.3). |
| **Ingestion PDF** | **Trois chemins** distincts (pas deux) : (1) `POST /api/documents/upload` — corpus direct, page `/database` ; (2) `POST /api/analyse/upload` — chunks temporaires (`is_temp=true`), module Analyse ; (3) script Python `scripts/ingest.py` — ingestion bulk `data/pdfs2/`. |
| **Bilingue FR/EN** | **Abandonné.** Colonnes `content_fr`/`embedding_fr`/`content_fr_tsv` toujours en base (legacy, non alimentées), aucune détection de langue côté recherche. |
| **Génération (LLM)** | OpenAI `gpt-4o-mini`, contexte + historique + question ; citations `[1]`, `[2]` ; streaming ; instruction "réponds dans la langue de la question" (pas de pipeline séparé par langue). |
| **Conversations et messages** | Tables + `getOrCreateConversation`, `insertMessage`, `getLastMessages` ; CRUD complet sur `/api/rag/conversations`. |
| **Paramétrage dynamique (admin)** | `GET`/`PATCH /api/rag/settings`, bornes validées côté back, 10 clés (dont `use_similarity_guard`, absente de l'ancienne doc). |
| **Rétention 30 jours** | `GET /api/cron/retention` (CRON_SECRET) ; `vercel.json` cron 4h UTC. |
| **Logs analytiques** | `query_logs` — une ligne par requête chat, alimente `/database` (heatmap). `lang` toujours `'en'` en pratique (jamais détecté). |

---

## 2. API Chat (flux réel)

### 2.1 Flux

1. Réception `query` (+ `conversationId`, `stream` optionnels).
2. Lecture `rag_settings` (`getRagSettings()`).
3. **Recherche** : `searchChunks(query, { matchThreshold: 0.01, matchCount: settings.match_count, settings })` → `match_chunks` + `search_chunks_fts` (anglais uniquement) → fusion RRF → `bestVectorSimilarity`.
4. **Garde-fou** (`isOutOfDomain`) : actif seulement si `use_similarity_guard=true` **et** (`chunks.length === 0` **ou** `bestVectorSimilarity < similarity_threshold`).
5. Si garde-fou déclenché → réponse = `guard_message`, **pas d'appel LLM**, message user + assistant insérés.
6. Sinon → historique (N derniers tours, `context_turns`) + chunks → LLM (stream ou non) → citations `[N]` construites depuis les chunks (`chunksToSources`).
7. `insertQueryLog()` (fire-and-forget, n'attend pas la réponse) enregistre la requête dans `query_logs` (analytique `/database`).

### 2.2 Route et paramètres

- **Route** : `POST /api/rag/chat`.
- **Body** : `{ query: string, conversationId?: string, stream?: boolean }` (stream par défaut `true`).
- **Réponse non-stream** : `{ answer, sources, conversationId, messageId }`.
- **Réponse stream** : SSE (`data: {"text":"..."}` puis `data: {"done":true, conversationId, messageId, sources}`).

### 2.3 Mode "connaissances générales" (non documenté auparavant)

Si `use_similarity_guard = false` (garde-fou désactivé par l'admin), le garde-fou classique ne bloque jamais. Mais pour éviter qu'une similarité faible ne produise quand même une réponse "je ne trouve rien dans le contexte" avec des chunks non pertinents comme sources, le back calcule un second indicateur :
- `contextRelevant` = vrai si la meilleure similarité parmi les chunks retournés dépasse `similarity_threshold` (garde-fou actif) ou **0.5** fixe (`MIN_SIMILARITY_FOR_STRICT_RAG`, garde-fou désactivé).
- Si le garde-fou est désactivé **et** `contextRelevant` est faux → `allowGeneralKnowledge = true` : le LLM répond sans s'appuyer sur le contexte (`sources: []`), en mode connaissances générales du modèle.

---

## 3. Recherche hybride (détail réel)

- **Pas de détection de langue.** `lib/rag/search.ts` interroge uniquement les RPC anglaises.
- **Vector** : RPC `match_chunks` (embedding 384D, exclut `is_temp=true` depuis juin 2026).
- **FTS** : RPC `search_chunks_fts` (`content_tsv`, config `english`).
- **Fusion** : RRF dans `lib/rag/search.ts`, paramètres `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k` (`rag_settings`).
- **Garde-fou** : basé sur la **meilleure similarité vectorielle** (avant fusion RRF).
- **Rerank** : `lib/rag/rerank.ts` existe dans le code mais n'est importé nulle part (`grep` sur `search.ts`, la route chat et les routes Analyse : aucun résultat) — **code mort**, ne pas le citer comme actif dans le mémoire.

---

## 4. Bilingue FR/EN — état réel (abandonné)

- Il **n'existe plus** de `lib/rag/detect-lang.ts` dans le code principal, ni de logique de langue dans `app/api/rag/chat/route.ts`.
- Les colonnes `content_fr`, `embedding_fr`, `content_fr_tsv` et les RPC `match_chunks_fr`/`search_chunks_fts_fr` existent toujours en base (migration `20260206100000_chunks_bilingue_fr.sql`, jamais `DROP`), mais **aucun code applicatif actuel ne les lit ni ne les écrit**.
- **Gestion de la langue de réponse** : le prompt système de `lib/rag/openai.ts` contient l'instruction *"Reply in the same language as the question"* — c'est le LLM qui adapte sa réponse à la langue de la requête, sans pipeline de recherche séparé par langue.
- `query_logs.lang` est toujours inséré à `'en'` en dur (`insertQueryLog` dans `lib/db/query-logs.ts`) — la colonne existe mais n'est jamais réellement détectée.

---

## 5. Ingestion des données (trois chemins, pas deux)

### 5.1 `POST /api/documents/upload` — corpus direct (page `/database`)

- **Pipeline** : `lib/ingestion/index.ts` (`ingestPdfBuffer`) → `parsePdfBuffer` (pdf-parse) → `chunkText` (paragraphes, ~400 caractères, overlap 50) → `embedQuery` (Xenova) → insert `documents` + `chunks`.
- **Dédup** : DOI extrait du texte ; si DOI déjà en base avec `status=done` → skip (`skipped: true`).
- **Pas de bilingue** : aucune colonne `content_fr`/`embedding_fr` écrite (contrairement à l'ancienne doc qui décrivait une copie EN→FR).
- **Stockage** : PDF non conservé, traité en mémoire ; `storage_path = upload/{uuid}.pdf`.
- Max 10 fichiers, 20 Mo chacun.

### 5.2 `POST /api/analyse/upload` — module Analyse (chunks temporaires)

- Distinct du chemin corpus : crée `document_analyses` + chunks avec `is_temp=true`, `analysis_id` renseigné.
- Même parsing/chunking (`parsePdfBuffer`, `chunkText`) mais **n'insère jamais dans le corpus permanent** tant que l'utilisateur n'a pas cliqué "intégrer" (`POST /api/analyse/[id]/integrate` → `is_temp=false`).
- Un seul fichier par appel (`file`, pas `files`).

### 5.3 Script Python `scripts/ingest.py` (ingestion bulk)

1. Source : `data/pdfs2/YEAR/` (organisation par année de publication, **pas** `data/pdfs/`), filtré par `YEAR_MIN`/`YEAR_MAX` dans `main()`. Flag `--author` pour `data/Articles auteur/`.
2. Skip si `storage_path` déjà en base avec `status=done`.
3. Extraction texte : PyMuPDF par page ; OCR (Tesseract + pdf2image) si texte < `MIN_TEXT_PER_PAGE` (50 caractères).
4. Chunking par sections (Abstract, Introduction, Methods…) puis blocs de `CHUNK_SIZE=600` caractères, overlap `CHUNK_OVERLAP=100`.
5. Embeddings EN (sentence-transformers all-MiniLM-L6-v2, 384D).
6. **Pas de traduction FR** : contrairement à l'ancienne version de ce document (qui décrivait MarianMT / opus-mt-en-fr), le script actuel **n'a aucune trace de traduction** — recherche `translat|Marian|content_fr|embedding_fr` dans `scripts/ingest.py` : zéro résultat.
7. Insert par batch (`INSERT_BATCH=50`, `INSERT_PAUSE=0.1s` — augmenté depuis 5/0.3s pour accélérer les gros runs).
8. Rebuild automatique de l'index IVFFlat en fin de script.

### 5.4 Comparaison des trois modes

| Aspect | `/api/documents/upload` | `/api/analyse/upload` | `scripts/ingest.py` |
|--------|--------------------------|------------------------|----------------------|
| Usage | Corpus direct, page Database | Analyse ponctuelle, temporaire | Ingestion bulk |
| Parse PDF | pdf-parse (Node) | pdf-parse (Node) | PyMuPDF (Python) |
| OCR | Non | Non | Oui |
| Chunk | ~400 car., overlap 50 | ~400 car., overlap 50 | 600 car., overlap 100, par section |
| Cible DB | `documents` + `chunks` (`is_temp=false`) | `document_analyses` + `chunks` (`is_temp=true`) | `documents` + `chunks` |
| Dédup | DOI | — (analyse individuelle) | storage_path |
| Traduction FR | Non | Non | Non |

### 5.5 Paramètres actuels (`ingest.py`)

| Paramètre | Valeur | Rôle |
|-----------|--------|------|
| PDF_DIR | `data/pdfs2` | Dossier des PDF (organisé par année de **publication**) |
| EMBED_DIM | 384 | Dimension des vecteurs |
| CHUNK_SIZE | 600 | Taille cible d'un bloc (caractères) |
| CHUNK_OVERLAP | 100 | Recouvrement entre deux chunks |
| MIN_TEXT_PER_PAGE | 50 | Seuil OCR |
| INSERT_BATCH | 50 | Chunks par requête (index droppé pendant l'ingestion) |
| INSERT_PAUSE | 0.1s | Pause entre batchs |

---

## 6. Génération (LLM) et contexte

- **Modèle** : `gpt-4o-mini`, `OPENAI_API_KEY`.
- **Prompt système** : s'appuyer sur le contexte, citer `[1]`, `[2]`… ; **"Reply in the same language as the question"** (pas d'instruction FR/EN séparée par pipeline).
- **Historique** : N derniers tours (`context_turns`, défaut 3), envoyés bruts (pas de résumé IA du fil).
- **Streaming** : `stream: true` par défaut ; sauvegarde du message assistant à la fin du stream.

---

## 7. Garde-fou

- Voir §2.1 et §2.3 pour le détail (garde-fou classique + mode connaissances générales, ce dernier absent de l'ancienne doc).
- Paramètres : `use_similarity_guard`, `similarity_threshold`, `guard_message` — modifiables via `PATCH /api/rag/settings`.

---

## 8. Conversations et messages (APIs en place)

Inchangé par rapport à l'ancienne version — toujours d'actualité :

| Route | Rôle |
|---|---|
| `GET /api/rag/conversations` | Liste (`?limit=50`), tri `updated_at` desc |
| `GET /api/rag/conversations/[id]/messages` | Pagination curseur (`?cursor=...&limit=20`) |
| `PATCH /api/rag/conversations/[id]` | Renommage (titre tronqué 255 car.) |
| `DELETE /api/rag/conversations/[id]` | Suppression + cascade messages |

---

## 9. Paramétrage dynamique (`rag_settings`)

### 9.1 Clés réelles (10, pas 8 — `use_similarity_guard` manquait dans l'ancienne doc)

| Clé | Description | Défaut |
|-----|-------------|--------|
| `use_similarity_guard` | Active/désactive le garde-fou (voir §2.3) | `true` |
| `context_turns` | Tours d'historique envoyés au LLM | 3 |
| `similarity_threshold` | Seuil garde-fou | 0.5 |
| `guard_message` | Message hors-domaine | "Requête trop éloignée…" |
| `match_count` | Chunks max retournés par la recherche vectorielle | 20 |
| `match_threshold` | Seuil minimal RPC | 0.3 |
| `fts_weight`, `vector_weight` | Poids RRF | 1, 1 |
| `rrf_k` | Paramètre k RRF | 60 |
| `hybrid_top_k` | Chunks après fusion, envoyés au LLM | 20 |

### 9.2 API admin

- `GET /api/rag/settings` : toutes les clés, valeurs parsées.
- `PATCH /api/rag/settings` : body partiel, validation des bornes (`RAG_SETTINGS_BOUNDS` dans `lib/rag/settings.ts`) — 400 + aucune écriture si hors bornes.
- **Bornes** : `context_turns` 1–10 ; `similarity_threshold` 0.1–0.9 ; `guard_message` max 1000 car. ; `match_count` 5–100 ; `match_threshold` 0–1 ; `fts_weight`/`vector_weight` 0–10 ; `rrf_k` 1–200 ; `hybrid_top_k` 5–100 ; `use_similarity_guard` booléen sans borne numérique.

---

## 10. Logs analytiques (`query_logs`)

Non documenté dans l'ancienne version. Chaque appel à `/api/rag/chat` insère une ligne (fire-and-forget) : `query_text`, `lang` (toujours `'en'` en pratique), `chunks_retrieved`, `best_similarity`, `was_guardrailed`, `conversation_id`. Alimente la RPC `get_query_stats_daily` utilisée par la page `/database` (heatmap d'activité).

---

## 11. Rétention 30 jours (en place, inchangé)

- Supprime `conversations` (+ `messages` cascade) où `updated_at < now() - 30 jours`.
- `GET /api/cron/retention`, protégé `CRON_SECRET`, cron Vercel `vercel.json` (4h UTC).

---

## 12. Références

| Document | Contenu |
|----------|---------|
| `STRUCTURE_ET_ARCHITECTURE.md` | Vue d'ensemble modules, dossiers |
| `SCHEMA_DB_ET_DONNEES.md` | Tables chunks, conversations, messages, rag_settings, query_logs |
| `PIPELINE_VEILLE_CONSOLIDE.md` | Réutilisation de `match_chunks`/`match_author_chunks` côté veille |
| `CLAUDE.md` | Pipeline Analyse (upload → insights → chat → intégration) |
