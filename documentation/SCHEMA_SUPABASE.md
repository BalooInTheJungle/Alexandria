# Schéma Supabase — Alexandria

**Migrations** : `supabase/migrations/` (ordre par préfixe de date).

---

## Appliquer les migrations (CLI)

Le CLI doit être **lié** au projet Supabase avant de pousser les migrations.

1. **Récupérer le project ref** : Dashboard Supabase → **Settings** → **General** → **Reference ID** (ou dans l’URL du projet : `https://supabase.com/dashboard/project/<REF>`).

2. **Lier le projet** (une fois) :
   ```bash
   npx supabase link --project-ref <REF>
   ```
   Indiquer le mot de passe de la base si demandé (Settings → Database → Database password).

3. **Pousser les migrations** :
   ```bash
   npx supabase db push
   ```

Si tu n’utilises pas le CLI : exécuter manuellement chaque fichier de `supabase/migrations/` dans l’ordre (Supabase Dashboard → **SQL Editor**).

---

## 1. Extension

- **vector** (pgvector) : stockage et recherche des embeddings.

---

## 2. Tables

### `public.sources`

URLs des pages à scraper pour la veille. Table unifiée (remplace ou complète `publications` / `source_url`).

| Colonne          | Type         | Description                    |
|------------------|--------------|--------------------------------|
| id               | uuid (PK)    |                                |
| url              | text         | URL de la page source          |
| name             | text         | Optionnel (label)              |
| created_at       | timestamptz  |                                |
| last_checked_at  | timestamptz  | Dernier scrape                |

**Peuplement** : si tu as déjà `publications` et `source_url`, insérer dans `sources` :
```sql
INSERT INTO sources (url, created_at, last_checked_at)
SELECT url, created_at, last_checked_at FROM publications;
INSERT INTO sources (url, created_at, last_checked_at)
SELECT url, created_at, last_checked_at FROM source_url;
```

---

### `public.documents`

Métadonnées des PDF. Les fichiers PDF sont stockés **localement dans le projet** (dossier **data/pdfs/**) ; pas de stockage sur Supabase. `storage_path` = **chemin relatif** vers le fichier (ex. `data/pdfs/mon-article.pdf`) pour le retrouver et l’afficher.

| Colonne       | Type         | Description                              |
|---------------|--------------|------------------------------------------|
| id            | uuid (PK)    |                                          |
| title         | text         |                                          |
| authors       | text[]       |                                          |
| doi           | text         |                                          |
| journal       | text         |                                          |
| published_at  | date         |                                          |
| storage_path  | text         | Chemin relatif du PDF (ex. data/pdfs/nom.pdf) |
| status        | text         | pending \| processing \| done \| error   |
| error_message | text         | Si status = error                       |
| ingestion_log | jsonb        | Résumé ingestion : titre/DOI/auteurs récupérés, chunks_count, ocr_pages_count, ingested_at (ou error) |
| created_at    | timestamptz  |                                          |
| updated_at    | timestamptz  |                                          |

**Index** : `documents(doi)`, `documents(status)`.

---

### `public.chunks`

Segments de documents pour le RAG (FTS + vector).

| Colonne       | Type           | Description                                  |
|---------------|----------------|----------------------------------------------|
| id            | uuid (PK)      |                                              |
| document_id   | uuid (FK)      | → documents.id                               |
| content       | text           | Texte du chunk                               |
| position      | int            | Ordre dans le document                       |
| page          | int            | Numéro de page (optionnel)                   |
| section_title | text           | Ex. "Introduction" (optionnel)               |
| embedding     | vector(1536)   | OpenAI ada-002 ; adapter si autre modèle     |
| content_tsv   | tsvector       | Pour FTS (anglais), maintenu par trigger     |
| created_at    | timestamptz    |                                              |

**Index** :  
- GIN sur `content_tsv` (FTS).  
- HNSW sur `embedding` (similarité cosinus).

**Dimension embedding** : 1536 (OpenAI). Si tu passes en open source (ex. 384 ou 768), exécuter :
```sql
ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(768);  -- ex.
```
puis recréer l’index sur `embedding` si besoin.

---

### `public.veille_runs`

Une run = toutes les sources d’un coup.

| Colonne       | Type         | Description                    |
|---------------|--------------|--------------------------------|
| id            | uuid (PK)    |                                |
| status        | text         | pending \| running \| completed \| failed |
| started_at    | timestamptz  |                                |
| completed_at | timestamptz  |                                |
| error_message | text         | Si échec global               |
| created_at    | timestamptz  |                                |

---

### `public.veille_items`

Articles récupérés par la veille. Dédup par DOI/URL gérée en app (guardrails).

| Colonne          | Type         | Description                    |
|------------------|--------------|--------------------------------|
| id               | uuid (PK)    |                                |
| run_id           | uuid (FK)    | → veille_runs.id               |
| source_id        | uuid (FK)    | → sources.id                  |
| url              | text         | URL de la page article         |
| title            | text         |                                |
| authors          | text[]       |                                |
| doi              | text         |                                |
| abstract         | text         |                                |
| published_at     | date         |                                |
| similarity_score | real         | Vs DB vectorielle             |
| last_error       | text         | Log skip + log (POC)           |
| created_at       | timestamptz  |                                |

**Index** : `veille_items(run_id)`, `veille_items(source_id)`, `veille_items(doi)`, `veille_items(url)` (pour guardrails).

---

### `public.conversations`

Fil de conversation du chatbot RAG. Titre modifiable ; rétention 30 jours (nettoyage à prévoir : cron ou job manuel).

| Colonne     | Type         | Description                              |
|-------------|--------------|------------------------------------------|
| id          | uuid (PK)    |                                          |
| title       | text         | Titre (généré à la création, éditable)   |
| created_at  | timestamptz  |                                          |
| updated_at  | timestamptz  | Dernière activité (pour tri sidebar)    |

**Index** : `conversations(updated_at desc)`.

---

### `public.messages`

Messages user / assistant par conversation. `sources` (jsonb) pour les réponses avec citations.

| Colonne          | Type         | Description                              |
|------------------|--------------|------------------------------------------|
| id               | uuid (PK)    |                                          |
| conversation_id | uuid (FK)    | → conversations.id                      |
| role             | text         | 'user' \| 'assistant'                    |
| content          | text         | Contenu du message                       |
| sources          | jsonb        | Sources/citations pour réponses assistant |
| created_at       | timestamptz  |                                          |

**Index** : `messages(conversation_id)`, `messages(conversation_id, created_at desc)` (pour scroll infini).

---

### `public.rag_settings`

Paramètres RAG modifiables depuis le panneau admin (sans redéploiement).

| Colonne    | Type         | Description                    |
|------------|--------------|--------------------------------|
| key        | text (PK)    | Ex. context_turns, similarity_threshold, guard_message, match_count, match_threshold |
| value      | text         | Valeur (string)                |
| updated_at | timestamptz  |                                |

**Clés** : `context_turns`, `similarity_threshold`, `guard_message`, `match_count`, `match_threshold` ; recherche hybride : `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k`.

---

## 3. RLS

Toutes les tables sont en RLS. **Tout utilisateur authentifié** peut SELECT / INSERT / UPDATE / DELETE selon les politiques (conversations, messages, rag_settings : lecture + mise à jour ; sources, documents, chunks, veille : comme avant).

---

## 4. Fichiers de migration (ordre d’exécution)

1. `20260204100000_enable_pgvector.sql`
2. `20260204100001_sources.sql`
3. `20260204100002_documents.sql`
4. `20260204100003_chunks.sql`
5. `20260204100004_veille.sql`
6. `20260204100005_rls.sql`
7. `20260204100006_chunks_embedding_384.sql` — dimension embedding 384 (all-MiniLM-L6-v2).
8. `20260205100000_documents_ingestion_log.sql` — colonne ingestion_log sur documents.
9. `20260205100001_match_chunks_rpc.sql` — RPC recherche vectorielle (match_chunks).
10. `20260205100002_conversations_messages.sql` — tables conversations et messages (chatbot).
11. `20260205100003_rag_settings.sql` — paramètres RAG (admin).
12. `20260205100004_search_chunks_fts.sql` — RPC recherche full-text (search_chunks_fts) pour recherche hybride.
13. `20260205100005_rag_settings_hybrid.sql` — paramètres hybride (fts_weight, vector_weight, rrf_k, hybrid_top_k).

Exécution : via le dashboard Supabase (SQL Editor, dans l’ordre) ou `supabase db push` si tu utilises la CLI.

**Rétention 30 jours** : les conversations plus anciennes peuvent être supprimées par un job planifié (cron, Supabase Edge Function ou script manuel) qui supprime les lignes de `conversations` (et en cascade `messages`) où `updated_at` < now() - interval '30 days'.
