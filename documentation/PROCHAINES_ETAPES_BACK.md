# Prochaines étapes back — par priorité

**Source** : BACK_RAG.md (récap par thème et priorité). Ce document liste ce qui est **déjà en place** et ce qui **reste à faire**, ordonné par **priorité** (P1 → P2 → P3), avec les actions concrètes.

---

## Déjà en place (back)

| Élément | Détail |
|--------|--------|
| **Recherche hybride** | FTS (`search_chunks_fts`) + vector (`match_chunks`) + fusion RRF dans `lib/rag/search.ts` ; paramètres dans `rag_settings`. |
| **API Chat** | `POST /api/rag/chat` (query, conversationId, stream) ; garde-fou ; N derniers messages ; persistance ; streaming SSE. |
| **Garde-fou** | Seuil + message lus depuis `rag_settings` ; pas d’appel LLM si best_similarity < seuil. |
| **Conversations / messages** | Tables + `getOrCreateConversation`, `insertMessage`, `getLastMessages` ; titre = troncature du premier message. |
| **Paramètres** | Lecture de tous les `rag_settings` (context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k). |
| **Ingestion PDF** | Script Python `scripts/ingest.py` : PyMuPDF, OCR, chunking, embeddings 384D ; traduction EN→FR (opus-mt-en-fr), content_fr, embedding_fr, content_fr_tsv. |
| **Bilingue FR/EN** | Détection langue (lib/rag/detect-lang.ts) ; pipeline EN/FR (search.ts) ; instruction langue (openai.ts) ; migration 20260206100000_chunks_bilingue_fr.sql appliquée. |

---

## Priorité 1 (P1) — Bilingue FR/EN — **Fait**

Objectif : l’utilisateur pose sa question en **français** ou en **anglais** ; la réponse et les sources sont dans la **même langue**.

### 1.1 Migration DB (bilingue) — fait

- Migration **20260206100000_chunks_bilingue_fr.sql** : colonnes content_fr, embedding_fr, content_fr_tsv ; trigger FTS french ; index GIN/HNSW ; RPC match_chunks_fr, search_chunks_fts_fr.

### 1.2 Back Node : détection de langue + pipeline EN/FR — fait

- **lib/rag/detect-lang.ts** : `detectQueryLanguage(query)` → `'fr' | 'en'` (heuristique).
- **lib/rag/search.ts** : paramètre `lang` ; selon lang, match_chunks/search_chunks_fts (EN) ou match_chunks_fr/search_chunks_fts_fr (FR).
- **lib/rag/openai.ts** : paramètre `lang` ; instruction « Réponds en français » / « Réponds en anglais » dans le prompt.
- **app/api/rag/chat/route.ts** : détection langue, passage de `lang` à searchChunks et aux appels OpenAI.

*(Ancien détail à faire, conservé pour référence :)*

1. **Détection de langue** : avant l’appel à `searchChunks`, analyser la requête (heuristique : accents, mots courants FR vs EN) → `lang = 'fr' | 'en'`. Défaut en cas d’ambiguïté : `'en'`.
2. **Recherche** : selon `lang`, appeler soit la pipeline actuelle (match_chunks + search_chunks_fts), soit la pipeline FR (match_chunks_fr + search_chunks_fts_fr). Pour la FR : si les chunks n’ont pas encore `content_fr` (anciens données), fallback possible sur `content` ou message explicite.
3. **Contexte envoyé au LLM** : utiliser `content` ou `content_fr` selon la langue pour construire le contexte et les sources (excerpt).
4. **Instruction de langue dans le prompt** : ajouter dans le message système ou utilisateur « Réponds uniquement en français » ou « Réponds uniquement en anglais » selon `lang`.

**Fichiers à modifier** :

- `lib/rag/search.ts` : accepter un paramètre `lang` ; appeler `match_chunks_fr` + `search_chunks_fts_fr` quand `lang === 'fr'` ; retourner les chunks avec le bon champ texte (content ou content_fr) pour que citations et contexte soient cohérents.
- `lib/rag/openai.ts` : accepter `lang` (ou les chunks déjà avec le bon content) et ajouter l’instruction de langue dans le prompt.
- `app/api/rag/chat/route.ts` : appeler un module de détection de langue (ex. `lib/rag/detect-lang.ts`), passer `lang` à `searchChunks` et à `generateRagAnswer` / `createRagAnswerStream` ; passer le bon champ pour les sources (excerpt).

**Fichier à créer** : `lib/rag/detect-lang.ts` (heuristique FR/EN).

### 1.3 Ingestion Python (bilingue) — fait

**Fait** : dans `scripts/ingest.py` : traduction EN→FR (opus-mt-en-fr), embedding_fr, insertion content_fr/embedding_fr. Dépendances : transformers, torch. Ré-ingérer les PDF après migration.

*(Détail initial :)* **À faire** : dans `scripts/ingest.py` :

1. Après le chunking, pour chaque chunk : **traduction EN→FR** avec un modèle local (ex. Hugging Face `Helsinki-NLP/opus-mt-en-fr`).
2. Calculer **embedding_fr** (même modèle sentence-transformers sur `content_fr`).
3. Insérer **content_fr** et **embedding_fr** dans chaque ligne `chunks` (le trigger Postgres remplira `content_fr_tsv`).

**Fichier à modifier** : `scripts/ingest.py`. Dépendance optionnelle : `transformers` + `opus-mt-en-fr` ou script séparé avec `pip install transformers sentencepiece`.

**Ordre** : exécuter la migration (1.1) avant de lancer l’ingestion bilingue. Ensuite ré-ingérer les PDF (ou seulement les nouveaux) pour remplir `content_fr` et `embedding_fr`.

---

## Priorité 2 (P2) — Conversations, admin, UX back

### 2.1 API conversations et messages

**À faire** :

| Route | Méthode | Description |
|-------|--------|-------------|
| Liste des conversations | `GET /api/rag/conversations` | Réponse : `{ id, title, created_at, updated_at }[]` ; ordre `updated_at` desc ; pagination optionnelle `?limit=50`. |
| Messages d’une conversation | `GET /api/rag/conversations/[id]/messages` | Query : `?cursor=message_id&limit=20` (cursor-based). Réponse : `{ id, role, content, sources?, created_at }[]` ; ordre `created_at` asc. |
| Modifier le titre | `PATCH /api/rag/conversations/[id]` | Body : `{ "title": "Nouveau titre" }`. |
| Supprimer une conversation | `DELETE /api/rag/conversations/[id]` | Suppression en base ; messages en cascade. |

**Fichiers à créer** :

- `app/api/rag/conversations/route.ts` (GET liste).
- `app/api/rag/conversations/[id]/route.ts` (PATCH, DELETE).
- `app/api/rag/conversations/[id]/messages/route.ts` (GET messages avec pagination cursor).

Réutiliser `lib/rag/conversation-persistence.ts` (ou étendre) pour les requêtes de lecture (liste, messages par conversation, mise à jour titre, suppression).

### 2.2 API admin (rag_settings)

**À faire** :

- **GET** : retourner toutes les clés/valeurs de `rag_settings` (pour affichage dans le panneau admin).
- **PATCH ou PUT** : accepter un body avec des clés à mettre à jour ; **valider les bornes** (context_turns 1–10, similarity_threshold 0.1–0.9, etc.) ; en cas d’erreur, retourner 400 sans modifier la base.

**Fichier à créer** : `app/api/rag/settings/route.ts` (GET + PATCH). Optionnel : fichier de descriptions (clé → texte pour l’UI) ou table dédiée.

---

## Priorité 3 (P3) — Rétention 30 jours

**À faire** :

- Route protégée (ex. `GET /api/cron/retention`) : vérifier une clé secrète (variable d’env) ; si ok, exécuter la suppression des conversations où `updated_at < now() - interval '30 days'` (Supabase client). Documenter l’appel (Vercel Cron ou script manuel).
- **Fichier à créer** : `app/api/cron/retention/route.ts` (ou équivalent). Référence : BACK_RAG.md §10.

---

## Ordre recommandé des implémentations

1. ~~**P1.1** — Migration bilingue (DB).~~ **Fait.**  
2. ~~**P1.2** — Back Node : détection langue + pipeline EN/FR + instruction dans le prompt.~~ **Fait.**  
3. ~~**P1.3** — Ingestion Python : traduction + embedding_fr + content_fr.~~ **Fait.**  
4. **P2.1** — API conversations (GET liste, GET messages, PATCH, DELETE).  
5. **P2.2** — API admin rag_settings (GET + PATCH avec validation).  
6. **P3** — Route rétention 30 jours + doc.

---

## Références

- **BACK_RAG.md** — détail de chaque thème (flux, paramètres, spécifications).  
- **SCHEMA_DB_ET_DONNEES.md** — structure des tables, migrations, flows.  
- **FONCTIONNALITES_FRONT.md** — besoins front (sidebar, scroll infini, admin) qui consomment ces APIs.
