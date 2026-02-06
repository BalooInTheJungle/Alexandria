# Back RAG — API, ingestion, génération, paramétrage, multilingue, conversation

**Rôle** : référence consolidée du **côté back** du RAG : ce qui est en place, ce qui reste à faire, **par thème** avec un **niveau de priorité** (P1, P2, P3).

---

## 1. Récapitulatif par thème et priorité

| Thème | Fait | À faire | Priorité |
|-------|------|---------|----------|
| **Recherche hybride (FTS + vector + RRF)** | FTS (search_chunks_fts) + vector (match_chunks) + fusion RRF ; paramètres dans rag_settings (fts_weight, vector_weight, rrf_k, hybrid_top_k). | — | — (en place) |
| **API Chat** | POST /api/rag/chat (query, conversationId, stream) ; garde-fou ; chargement N derniers messages ; persistance ; streaming SSE. | — | — (en place) |
| **Garde-fou hors domaine** | Seuil (similarity_threshold), message (guard_message) ; pas d’appel LLM si best_similarity < seuil ; enregistrement message user + assistant en base. | Panneau admin pour modifier seuil et message sans SQL. | **P2** |
| **Ingestion PDF** | Script Python (ingest.py) : PyMuPDF, OCR fallback, chunking par section, embeddings 384D (all-MiniLM-L6-v2), écriture chunks + content_tsv (english). | Traduction locale EN→FR ; content_fr, embedding_fr, content_fr_tsv (french) ; voir Bilingue. | **P1** (avec bilingue) |
| **Bilingue FR/EN** | — | Détection langue requête ; double index (content_fr, embedding_fr, FTS french) ; RPC match_chunks_fr, search_chunks_fts_fr ; pipeline EN vs FR ; instruction « Réponds en français » / « Réponds en anglais » dans le prompt. | **P1** |
| **Génération (LLM)** | OpenAI (gpt-4o-mini), contexte (chunks) + historique (N tours) + question ; citations [1], [2] ; streaming. | Ajouter instruction de langue (FR/EN) selon détection (lié bilingue). | **P1** (avec bilingue) |
| **Conversations et messages** | Tables conversations, messages ; getOrCreateConversation, insertMessage, getLastMessages ; titre = troncature premier message. | GET /api/rag/conversations ; GET /api/rag/conversations/[id]/messages (pagination cursor) ; PATCH titre ; DELETE conversation. | **P2** |
| **Paramétrage dynamique (admin)** | Lecture rag_settings (context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k). | API ou page pour lire/écrire rag_settings ; description par paramètre dans l’UI ; validation (bornes). | **P2** |
| **Rétention 30 jours** | — | Job/cron ou route API (ex. Vercel Cron) supprimant les conversations où updated_at < now() - 30 days ; doc. | **P3** |

---

## 2. API Chat (flux et comportement)

### 2.1 Flux actuel (un message utilisateur)

1. Réception **query** (+ optionnel **conversationId**, **stream**).  
2. **Chargement** des N derniers messages de la conversation (si conversationId) ; N = `rag_settings.context_turns` (ex. 3).  
3. **Recherche** : embedding de la requête → match_chunks + search_chunks_fts → fusion RRF → top-K chunks ; lecture **bestVectorSimilarity** (premier résultat vectoriel).  
4. **Garde-fou** : si bestVectorSimilarity < `similarity_threshold` → retour du **guard_message** (pas d’appel OpenAI) ; enregistrement message user + message assistant (garde-fou) en base.  
5. **Sinon** : construction du prompt (system + N derniers messages + contexte chunks + question) → appel OpenAI Chat Completions (stream ou non) → envoi au client ; à la fin du stream, enregistrement message assistant (content + sources) en base.

### 2.2 Route et paramètres

- **Route** : `POST /api/rag/chat`.  
- **Body** : `{ "query": string, "conversationId"?: string, "stream"?: boolean }`.  
- **Réponse (stream: false)** : `{ answer, sources, conversationId, messageId }`.  
- **Réponse (stream: true)** : flux SSE (`data: {"text":"..."}` puis `data: {"done":true, conversationId, messageId, sources}`).

---

## 3. Recherche hybride (détail)

- **Vector** : RPC `match_chunks(query_embedding, match_threshold, match_count)` sur `chunks.embedding` (384D, cosinus).  
- **FTS** : RPC `search_chunks_fts(query_text, match_limit)` sur `chunks.content_tsv` (config english).  
- **Fusion** : RRF dans `lib/rag/search.ts` ; paramètres `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k` (rag_settings).  
- **Garde-fou** : on utilise la **meilleure similarité vectorielle** (avant fusion) pour comparer au `similarity_threshold`.

---

## 4. Bilingue FR/EN (à implémenter)

### 4.1 Détection de la langue

- **Où** : côté back (API chat), **avant** toute recherche.  
- **Comment** : analyser **uniquement le texte de la requête** → `lang = 'fr' | 'en'`. Pas de décision selon les chunks qui matchent.  
- **Implémentation recommandée** : heuristique (accents, mots courants FR vs EN) ; défaut en cas d’ambiguïté : `'en'`.

### 4.2 Deux pipelines

- **Requête EN** : recherche sur `content`, `embedding`, `content_tsv` (english) ; contexte envoyé au LLM = `content` ; instruction « Réponds en anglais ».  
- **Requête FR** : recherche sur `content_fr`, `embedding_fr`, `content_fr_tsv` (french) ; RPC `match_chunks_fr`, `search_chunks_fts_fr` ; contexte = `content_fr` ; instruction « Réponds en français ».  
- **Citations** : excerpt = `content` ou `content_fr` selon la langue.

### 4.3 Ingestion (bilingue)

- Pour chaque chunk : **traduction locale** EN→FR (modèle Hugging Face, ex. Helsinki-NLP/opus-mt-en-fr) → `content_fr`.  
- Calcul **embedding_fr** (même modèle sur content_fr) ; trigger FTS french sur `content_fr_tsv`.  
- Ré-ingestion nécessaire après ajout des colonnes et des RPC (migration dédiée).

---

## 5. Ingestion des données (script Python)

### 5.1 Flow actuel (scripts/ingest.py)

1. Liste des PDF dans **data/pdfs/** ; skip si storage_path déjà en base avec status = done.  
2. **Extraction texte** : PyMuPDF par page ; si caractères < MIN_TEXT_PER_PAGE (50) → OCR (Tesseract + pdf2image).  
3. **Métadonnées** : titre (XMP ou première grosse ligne), DOI (regex sur les 10k premiers caractères).  
4. Insert **document** (status = processing).  
5. **Chunking** : sections (Abstract, Introduction, Methods, Results, Discussion, Conclusion, References, Acknowledgments) ; à l’intérieur d’une section, blocs CHUNK_SIZE (600) avec CHUNK_OVERLAP (100). Fallback : 1 chunk = texte tronqué à 8000 caractères. **Nettoyage** : `clean_text_for_db` (remplace `\x00` et `\u0000` par un espace) sur full_text, métadonnées, content et section_title avant insertion.  
6. **Embeddings** : sentence-transformers all-MiniLM-L6-v2, batch ; dimension 384.  
7. **Écriture** : insert chunks (content, document_id, position, page, section_title, embedding) ; content_tsv par trigger Postgres ; update document (status = done, ingestion_log).  
- **Stockage PDF** : dossier **data/pdfs/** (fichiers `*.pdf` ignorés par Git) ; `documents.storage_path` = chemin relatif (ex. `data/pdfs/nom.pdf`). Pas de Supabase Storage en POC.

### 5.2 Paramètres (ingest.py)

| Paramètre | Valeur | Rôle |
|-----------|--------|------|
| PDF_DIR | data/pdfs | Dossier des PDF. |
| EMBED_DIM | 384 | Dimension des vecteurs. |
| CHUNK_SIZE | 600 | Taille cible d’un bloc (caractères). |
| CHUNK_OVERLAP | 100 | Recouvrement entre deux chunks. |
| MIN_TEXT_PER_PAGE | 50 | Seuil en dessous duquel on tente l’OCR. |

### 5.3 Log d’ingestion (documents.ingestion_log)

- Clés : title_extracted, doi_extracted, authors_extracted, journal_extracted, published_at_extracted, chunks_count, ocr_pages_count, ingested_at. En cas d’erreur : `{ "error": "message", "ingested_at": "..." }`.

### 5.4 Points à surveiller avant extraction massive

- **Migrations** : exécuter `20260204100006_chunks_embedding_384.sql` (embedding 384D) et `20260205100000_documents_ingestion_log.sql` (ingestion_log).  
- **Environnement** : `.env.local` avec **NEXT_PUBLIC_SUPABASE_URL** (URL projet `https://xxx.supabase.co`) et **SUPABASE_SERVICE_ROLE_KEY**. Le script Python lit ce fichier sans lancer Next.js.  
- **Python / OCR** : `python3 -m pip install -r scripts/requirements.txt` ; **Poppler** (pour pdf2image) et **Tesseract** installés (macOS : brew ; Linux : apt).  
- **Idempotence** : PDF déjà en base avec **status = done** et même **storage_path** → ignorés. Documents en **error** ou **processing** → supprimés (doc + chunks) puis **ré-ingérés** au prochain run.  
- **Volume** : vérifier quotas Supabase (~10k docs × ~100–200 chunks = ordre de grandeur 1–2 M lignes dans `chunks`). Pour gros volume : lancer en **screen** / **tmux** ou en arrière-plan ; en cas de Ctrl+C, le document en cours reste en processing et sera ré-ingéré au prochain run.  
- **Contrôle** : après le run, vérifier en base `documents` (status, ingestion_log) et `chunks` (nombre, embedding non nul).

---

## 6. Génération (LLM) et contexte

- **Modèle** : OpenAI gpt-4o-mini ; variable d’env **OPENAI_API_KEY** (côté serveur ; voir `.env.local.example`).  
- **Message système** : s’appuyer uniquement sur le contexte, citer [1], [2]…, ne pas inventer.  
- **Contexte** : chunks numérotés avec (document, section) ; **à adapter** : ajouter instruction « Réponds en français » ou « Réponds en anglais » selon la langue détectée.  
- **Historique** : N derniers échanges (user + assistant) ; N = context_turns (défaut 3). En V1 on envoie les N derniers messages **bruts** (pas de récapitulatif par IA ; évolution possible avec un appel supplémentaire pour résumer le fil).  
- **Streaming** : stream: true ; sauvegarde du message assistant complète à la fin du stream. **Rerank** : optionnel (cross-encoder sur le top-K) ; pour le POC, FTS + vector + RRF → top-K direct au LLM. **Filtres métadonnées** (auteur, journal, période) : possibles en amont ou en aval de la recherche hybride (requêtes Supabase filtrées).

---

## 7. Garde-fou

- **Règle** : après recherche, si **bestVectorSimilarity < similarity_threshold** → requête hors domaine.  
- **Comportement** : pas d’appel OpenAI ; retour du **guard_message** ; enregistrement message user + message assistant (garde-fou) en base. Pour garder la même UX que les réponses normales, on peut renvoyer le message en « faux stream » (un seul chunk) au lieu d’un JSON unique.  
- **Paramètres** (rag_settings) : similarity_threshold, guard_message. À exposer en admin (P2).

---

## 8. Conversations et messages (APIs à ajouter)

### 8.1 GET liste des conversations

- **Route** : `GET /api/rag/conversations`.  
- **Réponse** : tableau `{ id, title, created_at, updated_at }` ; ordre updated_at décroissant.  
- **Pagination** : optionnelle (ex. ?limit=50).

### 8.2 GET messages d’une conversation

- **Route** : `GET /api/rag/conversations/[id]/messages`.  
- **Query** : pagination **cursor-based** (ex. ?cursor=message_id&limit=20). Curseur = id du dernier message de la page précédente ; requête suivante : `where conversation_id = X and created_at > (select created_at from messages where id = cursor) order by created_at asc limit N`. Ordre **created_at croissant** (plus ancien en premier) pour que le scroll vers le bas charge les messages plus récents.  
- **Réponse** : tableau `{ id, role, content, sources?, created_at }`. Pas d’aperçu supplémentaire dans la liste ; à l’intérieur de la conversation, l’aperçu est le contenu du message.

### 8.3 PATCH titre

- **Route** : `PATCH /api/rag/conversations/[id]`.  
- **Body** : `{ "title": "Nouveau titre" }`. Renommage **manuel uniquement** (pas de « régénérer le titre » par API en V1). Mise à jour de `conversations.title` et éventuellement `updated_at`. Évolution possible : générer le titre par appel OpenAI à partir du premier message (coût et latence en plus).

### 8.4 DELETE conversation

- **Route** : `DELETE /api/rag/conversations/[id]`.  
- **Comportement** : suppression en base ; messages en cascade. Côté front : modal de confirmation.

---

## 9. Paramétrage dynamique (rag_settings)

### 9.1 Clés existantes

| Clé | Description | Défaut / exemple |
|-----|-------------|-------------------|
| context_turns | Nombre de tours (paires user+assistant) envoyés au LLM. | 3 |
| similarity_threshold | Seuil garde-fou (en dessous : pas d’appel LLM). | 0.5 |
| guard_message | Message affiché quand requête hors domaine. | « Requête trop éloignée… » |
| match_count | Nombre max de chunks retournés par la recherche vectorielle. | 20 |
| match_threshold | Seuil minimal de similarité pour inclure un chunk (RPC). | 0.3 |
| fts_weight, vector_weight | Poids FTS et vector dans la fusion RRF. | 1, 1 |
| rrf_k | Paramètre k de la formule RRF. | 60 |
| hybrid_top_k | Nombre de chunks après fusion RRF (envoyés au LLM). | 20 |

### 9.2 À faire (admin)

- **Accès** : pas de protection supplémentaire ; l’admin est accessible depuis l’interface (même utilisateur que le reste). Un seul utilisateur ; pas de rôle admin séparé en V1.  
- API ou page pour **lire/écrire** ces clés (sans SQL).  
- **Description** par paramètre dans l’UI (impact sur le comportement), affichée à côté du champ.  
- **Validation** — bornes recommandées (API ou front) : context_turns 1–10 ; similarity_threshold 0.1–0.9 (float) ; match_count 5–100 (entier) ; match_threshold 0.0–1.0 (float) ; fts_weight, vector_weight ≥ 0 (float) ; rrf_k entier > 0 (ex. 1–200) ; hybrid_top_k 5–100 (entier). En cas de valeur hors bornes : retour d’erreur ou message dans l’UI, **sans modifier** la valeur en base.

---

## 10. Rétention 30 jours

- **Règle** : supprimer les conversations (et messages en cascade) où **updated_at < now() - 30 days** (pas d’activité depuis 30 jours). On s’appuie sur **updated_at**, pas sur created_at. **Pas de notification** utilisateur lors de la suppression.  
- **Déclenchement (option gratuite)** : **Vercel Cron** (si déploiement sur Vercel) : route dédiée (ex. GET /api/cron/retention) appelée par Vercel Cron (planification dans `vercel.json`) ; la route vérifie une **clé secrète** (env) pour éviter les appels non autorisés, puis exécute la suppression via Supabase. Sinon : **script manuel** SQL ou Node documenté.

---

## 11. Références vers les autres documents

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Besoins, flows, structure. |
| **Stack et technologies** | Rôle de chaque techno (embeddings, FTS, RRF, OpenAI, etc.). |
| **Fonctionnalités Front** | Sidebar, scroll infini, streaming, citations, langue, garde-fou, admin. Fichier : `FONCTIONNALITES_FRONT.md`. |
| **Schéma DB et données** | Tables chunks (content_fr, embedding_fr, content_fr_tsv), conversations, messages, rag_settings ; migrations ; flows back ↔ DB. Fichier : `SCHEMA_DB_ET_DONNEES.md`. |
