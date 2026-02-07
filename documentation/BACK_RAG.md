# Back RAG — API, ingestion, génération, paramétrage, multilingue, conversation

**Rôle** : référence consolidée du **côté back** du RAG : ce qui est en place, ce qui reste à faire, **par thème** avec un **niveau de priorité** (P1, P2, P3).

---

## 1. Récapitulatif par thème et priorité

| Thème | Fait | À faire | Priorité |
|-------|------|---------|----------|
| **Recherche hybride (FTS + vector + RRF)** | FTS + vector + RRF ; selon lang : match_chunks/search_chunks_fts (EN) ou match_chunks_fr/search_chunks_fts_fr (FR). | — | — (en place) |
| **API Chat** | POST /api/rag/chat ; détection langue ; garde-fou ; N derniers messages ; persistance ; streaming SSE. | — | — (en place) |
| **Garde-fou hors domaine** | Seuil (similarity_threshold), message (guard_message) ; pas d’appel LLM si best_similarity < seuil. Modifiable via PATCH /api/rag/settings. | — | — (en place) |
| **Ingestion PDF** | Script Python (ingest.py) : PyMuPDF, OCR, chunking, embeddings 384D ; traduction EN→FR (opus-mt-en-fr), content_fr, embedding_fr, content_fr_tsv (trigger french). | — | — (en place) |
| **Bilingue FR/EN** | Détection heuristique (detect-lang.ts) ; colonnes + RPC FR ; pipeline EN/FR (search.ts) ; instruction langue (openai.ts). | — | — (en place) |
| **Génération (LLM)** | OpenAI (gpt-4o-mini), contexte + historique + question ; citations [1], [2] ; streaming ; instruction FR/EN selon lang. | — | — (en place) |
| **Conversations et messages** | Tables + getOrCreateConversation, insertMessage, getLastMessages ; **GET /api/rag/conversations** (liste) ; **GET /api/rag/conversations/[id]/messages** (pagination cursor) ; **PATCH /api/rag/conversations/[id]** (titre) ; **DELETE /api/rag/conversations/[id]** (cascade messages). | — | — (en place) |
| **Paramétrage dynamique (admin)** | Lecture rag_settings ; **GET /api/rag/settings** (toutes les clés) ; **PATCH /api/rag/settings** (body partiel, validation des bornes ; 400 si invalide, aucune modification en base). | Page admin pour afficher/éditer (optionnel). | — (en place) |
| **Rétention 30 jours** | GET /api/cron/retention (CRON_SECRET) ; vercel.json cron 4 h UTC ; suppression conversations + cascade. | — | — (en place) |

---

## 2. API Chat (flux et comportement)

### 2.1 Flux actuel (un message utilisateur)

1. Réception **query** (+ optionnel **conversationId**, **stream**).  
2. **Détection de langue** : heuristique sur la requête → `lang = 'fr' | 'en'` (lib/rag/detect-lang.ts).  
3. **Chargement** des N derniers messages (si conversationId) ; N = `rag_settings.context_turns`.  
4. **Recherche** : embedding → selon lang, match_chunks + search_chunks_fts (EN) ou match_chunks_fr + search_chunks_fts_fr (FR) → fusion RRF → top-K chunks ; **bestVectorSimilarity**.  
5. **Garde-fou** : si bestVectorSimilarity < `similarity_threshold` → retour du **guard_message** (pas d’appel OpenAI) ; enregistrement message user + message assistant (garde-fou) en base.  
6. **Sinon** : prompt (system + instruction « Réponds en français » / « Réponds en anglais » selon lang + N messages + contexte + question) → OpenAI (stream ou non) ; enregistrement message assistant (content + sources) en base.

### 2.2 Route et paramètres

- **Route** : `POST /api/rag/chat`.  
- **Body** : `{ "query": string, "conversationId"?: string, "stream"?: boolean }`.  
- **Réponse (stream: false)** : `{ answer, sources, conversationId, messageId }`.  
- **Réponse (stream: true)** : flux SSE (`data: {"text":"..."}` puis `data: {"done":true, conversationId, messageId, sources}`).

---

## 3. Recherche hybride (détail)

- **Détection langue** : `lib/rag/detect-lang.ts` → `detectQueryLanguage(query)` retourne `'fr'` ou `'en'`.  
- **Vector** : selon `lang`, RPC `match_chunks` (EN, sur `chunks.embedding`) ou `match_chunks_fr` (FR, sur `chunks.embedding_fr`) ; même signature (query_embedding 384D, match_threshold, match_count).  
- **FTS** : selon `lang`, RPC `search_chunks_fts` (EN, `content_tsv`, config english) ou `search_chunks_fts_fr` (FR, `content_fr_tsv`, `plainto_tsquery('french', query_text)`).  
- **Fusion** : RRF dans `lib/rag/search.ts` ; paramètres `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k` (rag_settings). Les chunks retournés ont le bon champ texte (content ou content_fr) pour contexte et citations.  
- **Fallback FR → EN** : si `lang === 'fr'` et `match_chunks_fr` renvoie 0 chunks, le back refait la recherche avec `match_chunks` + `search_chunks_fts` (EN) pour éviter un « hors domaine » quand la base n’a pas encore d’embedding_fr.  
- **Garde-fou** : on utilise la **meilleure similarité vectorielle** (avant fusion) pour comparer au `similarity_threshold`.

---

## 4. Bilingue FR/EN (implémenté)

### 4.1 Détection de la langue

- **Fichier** : `lib/rag/detect-lang.ts`.  
- **Fonction** : `detectQueryLanguage(query)` → `'fr' | 'en'`. Heuristique : accents français, mots-outils FR vs EN ; défaut `'en'`. Appelée dans la route chat avant la recherche.  
- **Implémentation recommandée** : heuristique (accents, mots courants FR vs EN) ; défaut en cas d’ambiguïté : `'en'`.

### 4.2 Deux pipelines

- **Requête EN** : recherche sur `content`, `embedding`, `content_tsv` (english) ; contexte envoyé au LLM = `content` ; instruction « Réponds en anglais ».  
- **Requête FR** : recherche sur `content_fr`, `embedding_fr`, `content_fr_tsv` (french) ; RPC `match_chunks_fr`, `search_chunks_fts_fr` ; contexte = `content_fr` ; instruction « Réponds en français ».  
- **Citations** : excerpt = `content` ou `content_fr` selon la langue.

### 4.3 Ingestion (bilingue)

- **Script** : `scripts/ingest.py`. Traduction EN→FR (Helsinki-NLP/opus-mt-en-fr, batches) ; **embedding_fr** = même modèle sentence-transformers sur content_fr. Insertion content_fr, embedding_fr ; triggers remplissent content_fr_tsv. **Migration** : `20260206100000_chunks_bilingue_fr.sql`. Ré-ingestion des PDF après migration pour remplir content_fr / embedding_fr.

---

## 5. Ingestion des données (script Python)

### 5.1 Flow actuel (scripts/ingest.py)

1. Liste des PDF dans **data/pdfs/** ; skip si storage_path déjà en base avec status = done.  
2. **Extraction texte** : PyMuPDF par page ; si caractères < MIN_TEXT_PER_PAGE (50) → OCR (Tesseract + pdf2image).  
3. **Métadonnées** : titre (XMP ou première grosse ligne), DOI (regex sur les 10k premiers caractères).  
4. Insert **document** (status = processing).  
5. **Chunking** : sections (Abstract, Introduction, Methods, Results, Discussion, Conclusion, References, Acknowledgments) ; à l’intérieur d’une section, blocs CHUNK_SIZE (600) avec CHUNK_OVERLAP (100). Fallback : 1 chunk = texte tronqué à 8000 caractères. **Nettoyage** : `clean_text_for_db` (remplace `\x00` et `\u0000` par un espace) sur full_text, métadonnées, content et section_title avant insertion.  
6. **Embeddings EN** : sentence-transformers all-MiniLM-L6-v2, batch ; dimension 384.  
7. **Traduction EN→FR** : modèle **MarianMT** (Helsinki-NLP/opus-mt-en-fr) via `MarianMTModel` + `MarianTokenizer` (sans pipeline) ; device MPS (Apple Silicon) ou CUDA ou CPU ; batches de 24 ; troncature ~512 tokens ; décodage greedy (num_beams=1) pour la vitesse. Dépendances : `transformers`, `sentencepiece`, `torch`.  
8. **Embeddings FR** : même modèle sentence-transformers sur les textes français → embedding_fr.  
9. **Écriture** : insert chunks par **batch de 50** (content, embedding, content_fr, embedding_fr, document_id, position, page, section_title) ; content_tsv et content_fr_tsv par triggers ; update document (status = done, ingestion_log). En fin de run : log récap (nombre de documents done, chunks total, chunks avec content_fr).  
- **Stockage PDF** : **data/pdfs/** ; `documents.storage_path` = chemin relatif. Pas de Supabase Storage en POC.

### 5.2 Paramètres (ingest.py)

| Paramètre | Valeur | Rôle |
|-----------|--------|------|
| PDF_DIR | data/pdfs | Dossier des PDF. |
| EMBED_DIM | 384 | Dimension des vecteurs. |
| CHUNK_SIZE | 600 | Taille cible d’un bloc (caractères). |
| CHUNK_OVERLAP | 100 | Recouvrement entre deux chunks. |
| MIN_TEXT_PER_PAGE | 50 | Seuil en dessous duquel on tente l’OCR. |
| TRANSLATE_BATCH_SIZE | 24 | Nombre de textes par batch de traduction (MarianMT). |
| TRANSLATE_NUM_BEAMS | 1 | 1 = greedy (rapide), 5 = beam (meilleure qualité). |

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
- **Paramètres** (rag_settings) : similarity_threshold, guard_message. Modifiables via **PATCH /api/rag/settings** (voir §9).

---

## 8. Conversations et messages (APIs en place)

Toutes les routes ci‑dessous sont implémentées. Le client Supabase serveur (cookies) + RLS **authenticated** s’appliquent.

### 8.1 GET liste des conversations

- **Route** : `GET /api/rag/conversations`.  
- **Query** : `?limit=50` (optionnel, max 100).  
- **Réponse** : tableau `{ id, title, created_at, updated_at }[]` ; ordre **updated_at** décroissant.

### 8.2 GET messages d’une conversation

- **Route** : `GET /api/rag/conversations/[id]/messages`.  
- **Query** : `?cursor=message_id&limit=20`. **Curseur** = id du dernier message de la page précédente ; page suivante = messages avec `created_at` strictement après ce message ; ordre **created_at** croissant.  
- **Réponse** : tableau `{ id, role, content, sources?, created_at }[]`.

### 8.3 PATCH titre

- **Route** : `PATCH /api/rag/conversations/[id]`.  
- **Body** : `{ "title": "Nouveau titre" }`. Titre tronqué à 255 caractères. Réponse : `{ id, title }` ou 404.

### 8.4 DELETE conversation

- **Route** : `DELETE /api/rag/conversations/[id]`.  
- **Comportement** : suppression en base ; messages supprimés en **cascade**. Réponse : **204** ou 404.

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

### 9.2 API admin (en place)

- **GET /api/rag/settings** : retourne toutes les clés avec valeurs parsées (même structure que celle utilisée par le chat). Utilisable pour pré-remplir le panneau admin.  
- **PATCH /api/rag/settings** : body = objet partiel (ex. `{ "similarity_threshold": 0.4 }`). Seules les clés connues sont prises en compte. **Validation côté back** : si une valeur est hors bornes → **400** avec `{ "error": "message" }` et **aucune modification en base**. Réponse en succès : objet settings complet (après mise à jour).  
- **Bornes appliquées** (dans `lib/rag/settings.ts`, `RAG_SETTINGS_BOUNDS`) : context_turns 1–10 ; similarity_threshold 0.1–0.9 ; guard_message longueur max 1000 ; match_count 5–100 ; match_threshold 0–1 ; fts_weight, vector_weight 0–10 ; rrf_k 1–200 ; hybrid_top_k 5–100.  
- **Accès** : même authentification que le reste (RLS authenticated sur rag_settings). Page admin au front optionnelle (affichage + formulaire qui appelle GET puis PATCH).

---

## 10. Rétention 30 jours (en place)

- **Règle** : supprimer les conversations (et messages en cascade) où **updated_at < now() - 30 days** (pas d’activité depuis 30 jours). On s’appuie sur **updated_at**, pas sur created_at. **Pas de notification** utilisateur.  
- **Route** : **GET /api/cron/retention**. Protégée par **CRON_SECRET** (variable d’env) : accepter uniquement si `Authorization: Bearer <CRON_SECRET>` ou `?secret=<CRON_SECRET>`. Réponse : `{ deleted: number }` ou 401/500.  
- **Vercel Cron** : dans `vercel.json`, crons `path: "/api/cron/retention"`, `schedule: "0 4 * * *"` (tous les jours à 4 h UTC). Définir **CRON_SECRET** dans les env du projet Vercel ; Vercel envoie ce secret en `Authorization: Bearer` lors de l’appel.  
- **Script manuel** : `curl -H "Authorization: Bearer $CRON_SECRET" "https://<ton-domaine>/api/cron/retention"` ou `"?secret=$CRON_SECRET"`.  
- **Fichier** : `app/api/cron/retention/route.ts` (client Supabase **admin** pour la suppression, sans session utilisateur).

---

## 11. Références vers les autres documents

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Besoins, flows, structure. |
| **Stack et technologies** | Rôle de chaque techno (embeddings, FTS, RRF, OpenAI, etc.). |
| **Fonctionnalités Front** | Sidebar, scroll infini, streaming, citations, langue, garde-fou, admin. Fichier : `FONCTIONNALITES_FRONT.md`. |
| **Schéma DB et données** | Tables chunks (content_fr, embedding_fr, content_fr_tsv), conversations, messages, rag_settings ; migrations ; flows back ↔ DB. Fichier : `SCHEMA_DB_ET_DONNEES.md`. |
