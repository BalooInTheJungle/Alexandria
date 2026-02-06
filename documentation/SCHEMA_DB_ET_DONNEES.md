# Schéma DB et données — Alexandria

**Rôle** : référence des **tables Supabase**, du **tableau des migrations** et des **flows** (listes numérotées) entre le back et la base de données. Inclut la prévision bilingue (chunks FR/EN).

---

## Appliquer les migrations (CLI)

Le CLI doit être **lié** au projet Supabase avant de pousser les migrations.

1. **Récupérer le project ref** : Dashboard Supabase → **Settings** → **General** → **Reference ID** (ou dans l’URL du projet : `https://supabase.com/dashboard/project/<REF>`).  
2. **Lier le projet** (une fois) : `npx supabase link --project-ref <REF>`. Indiquer le mot de passe de la base si demandé (Settings → Database → Database password).  
3. **Pousser les migrations** : `npx supabase db push`.

Si tu n’utilises pas le CLI : exécuter **manuellement** chaque fichier de `supabase/migrations/` **dans l’ordre** (Supabase Dashboard → **SQL Editor**).

---

## 1. Extension

- **vector** (pgvector) : stockage et recherche des embeddings (colonnes `vector(384)`).

---

## 2. Tables

### 2.1 `public.sources`

URLs des pages à scraper pour la veille. Tout est en base (pas de config fichier).

| Colonne          | Type         | Description           |
|------------------|--------------|-----------------------|
| id               | uuid (PK)    |                       |
| url              | text         | URL de la page source |
| name             | text         | Optionnel (label)     |
| created_at       | timestamptz  |                       |
| last_checked_at  | timestamptz  | Dernier scrape        |

**Peuplement** : si tu as déjà des tables `publications` ou `source_url`, tu peux insérer dans `sources` : `INSERT INTO sources (url, created_at, last_checked_at) SELECT url, created_at, last_checked_at FROM publications;` (et idem depuis source_url si pertinent).

---

### 2.2 `public.documents`

Métadonnées des PDF. Les fichiers sont en **data/pdfs/** (ou Storage) ; `storage_path` = chemin relatif.

| Colonne       | Type         | Description                                        |
|---------------|--------------|----------------------------------------------------|
| id            | uuid (PK)    |                                                    |
| title         | text         |                                                    |
| authors       | text[]       |                                                    |
| doi           | text         |                                                    |
| journal       | text         |                                                    |
| published_at  | date         |                                                    |
| storage_path  | text         | Chemin relatif (ex. data/pdfs/nom.pdf)             |
| status        | text         | pending \| processing \| done \| error             |
| error_message | text         | Si status = error                                  |
| ingestion_log | jsonb        | chunks_count, ocr_pages_count, ingested_at, error  |
| created_at    | timestamptz  |                                                    |
| updated_at    | timestamptz  |                                                    |

**Index** : documents(doi), documents(status).

---

### 2.3 `public.chunks`

Segments de documents pour le RAG (FTS + vector). Contenu **anglais** (original) ; **prévision bilingue** : colonnes françaises ci‑dessous.

| Colonne       | Type           | Description                                |
|---------------|----------------|--------------------------------------------|
| id            | uuid (PK)      |                                            |
| document_id   | uuid (FK)      | → documents.id                             |
| content       | text           | Texte du chunk (anglais, original)         |
| position      | int            | Ordre dans le document                     |
| page          | int            | Numéro de page (optionnel)                 |
| section_title | text           | Ex. "Introduction" (optionnel)              |
| embedding     | vector(384)    | Embedding du contenu EN (all-MiniLM-L6-v2) |
| content_tsv   | tsvector       | FTS **anglais**, maintenu par trigger      |
| created_at    | timestamptz    |                                            |

**Prévision bilingue FR/EN** (migrations à venir) :

| Colonne        | Type           | Description                                  |
|----------------|----------------|----------------------------------------------|
| content_fr     | text           | Traduction française (ingestion, local)      |
| embedding_fr   | vector(384)    | Embedding du texte français                  |
| content_fr_tsv | tsvector       | FTS **french**, maintenu par trigger         |

**Index** : GIN sur content_tsv ; HNSW sur embedding. Prévision : GIN sur content_fr_tsv ; HNSW sur embedding_fr.

**RPC** : `match_chunks` (vector EN), `search_chunks_fts` (FTS english). Prévision : `match_chunks_fr`, `search_chunks_fts_fr`.

---

### 2.4 `public.veille_runs`

Une run = toutes les sources d’un coup.

| Colonne       | Type         | Description                              |
|---------------|--------------|------------------------------------------|
| id            | uuid (PK)    |                                          |
| status        | text         | pending \| running \| completed \| failed |
| started_at    | timestamptz  |                                          |
| completed_at  | timestamptz  |                                          |
| error_message | text         | Si échec global                          |
| created_at    | timestamptz  |                                          |

---

### 2.5 `public.veille_items`

Articles récupérés par la veille. Dédup par DOI/URL gérée en app (guardrails).

| Colonne          | Type         | Description                |
|------------------|--------------|----------------------------|
| id               | uuid (PK)    |                            |
| run_id           | uuid (FK)    | → veille_runs.id           |
| source_id        | uuid (FK)    | → sources.id               |
| url              | text         | URL de la page article     |
| title            | text         |                            |
| authors          | text[]       |                            |
| doi              | text         |                            |
| abstract         | text         |                            |
| published_at     | date         |                            |
| similarity_score | real         | Vs DB vectorielle          |
| last_error       | text         | Log en cas d’échec (POC)   |
| created_at       | timestamptz  |                            |

**Index** : veille_items(run_id), veille_items(source_id), veille_items(doi), veille_items(url).

---

### 2.6 `public.conversations`

Fil de conversation du chatbot RAG. Rétention 30 jours (nettoyage par job/cron).

| Colonne     | Type         | Description                            |
|-------------|--------------|----------------------------------------|
| id          | uuid (PK)    |                                        |
| title       | text         | Généré à la création, éditable        |
| created_at  | timestamptz  |                                        |
| updated_at  | timestamptz  | Dernière activité (tri sidebar)       |

**Index** : conversations(updated_at desc).

---

### 2.7 `public.messages`

Messages user / assistant par conversation. `sources` = citations pour les réponses assistant.

| Colonne          | Type         | Description                    |
|------------------|--------------|--------------------------------|
| id               | uuid (PK)    |                                |
| conversation_id  | uuid (FK)    | → conversations.id             |
| role             | text         | 'user' \| 'assistant'          |
| content          | text         | Contenu du message             |
| sources          | jsonb        | Sources/citations (assistant)  |
| created_at       | timestamptz  |                                |

**Index** : messages(conversation_id), messages(conversation_id, created_at desc).

---

### 2.8 `public.rag_settings`

Paramètres RAG modifiables depuis le panneau admin (clé/valeur).

| Colonne    | Type         | Description                                      |
|------------|--------------|--------------------------------------------------|
| key        | text (PK)    | context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k |
| value      | text         | Valeur (string)                                  |
| updated_at | timestamptz  |                                                  |

---

## 3. Tableau des migrations

| N° | Fichier | Objectif |
|----|---------|----------|
| 1 | 20260204100000_enable_pgvector.sql | Activer l’extension pgvector. |
| 2 | 20260204100001_sources.sql | Table sources (veille). |
| 3 | 20260204100002_documents.sql | Table documents (métadonnées PDF). |
| 4 | 20260204100003_chunks.sql | Table chunks (content, embedding, content_tsv, trigger FTS english). |
| 5 | 20260204100004_veille.sql | Tables veille_runs, veille_items. |
| 6 | 20260204100005_rls.sql | Politiques RLS. |
| 7 | 20260204100006_chunks_embedding_384.sql | Dimension embedding 384 (all-MiniLM-L6-v2). |
| 8 | 20260205100000_documents_ingestion_log.sql | Colonne ingestion_log sur documents. |
| 9 | 20260205100001_match_chunks_rpc.sql | RPC match_chunks (recherche vectorielle 384D). |
| 10 | 20260205100002_conversations_messages.sql | Tables conversations, messages (chatbot). |
| 11 | 20260205100003_rag_settings.sql | Table rag_settings (paramètres RAG). |
| 12 | 20260205100004_search_chunks_fts.sql | RPC search_chunks_fts (FTS english). |
| 13 | 20260205100005_rag_settings_hybrid.sql | Clés hybride (fts_weight, vector_weight, rrf_k, hybrid_top_k). |
| 14 | *(À créer)* | Bilingue FR/EN : colonnes chunks (content_fr, embedding_fr, content_fr_tsv), trigger FTS french, index, RPC match_chunks_fr, search_chunks_fts_fr. |

**Rétention 30 jours** : job/cron supprimant les lignes de `conversations` (et en cascade `messages`) où `updated_at` < now() - interval '30 days'. Pas de notification utilisateur. Voir **BACK_RAG.md** §10 pour les options (Vercel Cron, script manuel).

---

## 4. Flows back ↔ DB (listes numérotées)

### 4.1 Requête RAG (chat)

1. Back reçoit la requête (POST /api/rag/chat).  
2. Back lit **rag_settings** (context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k).  
3. Si conversationId fourni : back lit les **messages** (conversation_id, ordre created_at) pour les N derniers tours.  
4. Back embed la requête (modèle local) puis appelle **match_chunks** (ou **match_chunks_fr** si langue FR) avec le vecteur ; lit **chunks** (+ jointure **documents** pour titre, DOI, storage_path).  
5. Si FTS activé : back appelle **search_chunks_fts** (ou **search_chunks_fts_fr** si FR) ; même jointure chunks + documents.  
6. Back fusionne (RRF) et garde bestVectorSimilarity ; si bestVectorSimilarity < similarity_threshold → pas d’appel LLM, back insère **messages** (user + assistant avec guard_message) et met à jour **conversations** (updated_at).  
7. Sinon : back appelle LLM, stream la réponse ; à la fin du stream, back insère **messages** (user + assistant avec content et sources) et met à jour **conversations** (updated_at).  
8. Si nouvelle conversation : back insère **conversations** (titre = troncature requête) puis **messages**.

### 4.2 Liste des conversations

1. Front appelle GET /api/rag/conversations.  
2. Back lit **conversations** (ordre updated_at desc, limit optionnel).  
3. Back renvoie id, title, created_at, updated_at.

### 4.3 Messages d’une conversation (scroll infini)

1. Front appelle GET /api/rag/conversations/[id]/messages?cursor=...&limit=20.  
2. Back lit **messages** (conversation_id, created_at > cursor, ordre created_at asc, limit).  
3. Back renvoie id, role, content, sources, created_at.

### 4.4 PATCH titre / DELETE conversation

1. **PATCH** : back reçoit { title } ; back met à jour **conversations** (title, updated_at) pour l’id donné.  
2. **DELETE** : back supprime la ligne **conversations** pour l’id donné ; **messages** supprimés en cascade (FK).

### 4.5 Ingestion PDF (script Python)

1. Script lit le dossier data/pdfs (liste des PDF).  
2. Pour chaque PDF non déjà en base (storage_path + status = done) : script insère **documents** (status = processing, storage_path, métadonnées).  
3. Script extrait le texte (PyMuPDF, OCR si besoin), chunk, calcule les embeddings (et en bilingue : traduction → content_fr, embedding_fr).  
4. Script insère **chunks** (document_id, content, position, page, section_title, embedding ; + content_fr, embedding_fr si bilingue). Les triggers Postgres remplissent content_tsv (et content_fr_tsv si bilingue).  
5. Script met à jour **documents** (status = done, ingestion_log, updated_at). En cas d’erreur : status = error, error_message, ingestion_log.

### 4.6 Veille (run)

1. Back ou job lit **sources** (liste des URLs).  
2. Back crée **veille_runs** (status = running, started_at).  
3. Pour chaque source : fetch HTML, extraction URLs, guardrails (dédup vs **veille_items** / documents par DOI), filtrage LLM, extraction article LLM ; pour chaque article : insertion **veille_items** (run_id, source_id, url, title, authors, doi, abstract, published_at, similarity_score, last_error si échec).  
4. Back met à jour **veille_runs** (status = completed ou failed, completed_at, error_message).

### 4.7 Admin — paramètres RAG

1. Front demande la liste des paramètres : back lit **rag_settings** (toutes les lignes).  
2. Front envoie des modifications : back met à jour **rag_settings** (UPDATE par clé) après validation (bornes).  
3. Les API RAG relisent **rag_settings** à chaque requête chat.

---

## 5. RLS

Toutes les tables sont en RLS. **Utilisateur authentifié** : SELECT / INSERT / UPDATE / DELETE selon les politiques (conversations, messages, rag_settings : lecture + mise à jour ; sources, documents, chunks, veille : selon règles métier).

---

## 6. Références

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Flows d’usage, structure. |
| **Back RAG** | Détail des API et de l’usage des tables/RPC. |
| **Pipeline veille** | Usage de sources, veille_runs, veille_items. |
| **Back RAG** §4 | Détail colonnes et RPC bilingues (détection langue, pipelines EN/FR). |
