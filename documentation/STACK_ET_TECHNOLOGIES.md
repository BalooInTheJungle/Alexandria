# Stack et technologies — Alexandria

**Rôle** : document de référence des **technologies utilisées** dans le projet et de **leur usage** (où et pourquoi). Une seule app, tout sur cloud (Supabase + Next.js).

---

## 1. Vue d’ensemble

- **Front et API** : Next.js (React, TypeScript), hébergement type Vercel ou équivalent.
- **Données et auth** : Supabase (Postgres, pgvector, FTS, Auth, Storage).
- **RAG** : embeddings locaux (pas d’API payante) ; génération des réponses via API OpenAI.
- **Ingestion PDF** : script Python (PyMuPDF, sentence-transformers, Supabase).
- **Veille** : scraping HTML ; sources et runs en base ; à terme similarité abstract vs corpus.

---

## 2. Front et serveur (Next.js)

| Technologie | Version / détail | Rôle dans le projet |
|-------------|------------------|----------------------|
| **Next.js** | 14.x (App Router) | Application web : pages (RAG, Bibliographie, Documents), routing, rendu serveur. |
| **React** | 18.x | Composants UI (chat, liste conversations, formulaire, affichage sources). |
| **TypeScript** | 5.x | Typage du code (app, lib, API). |
| **API Routes** (Next) | — | Routes serveur : `/api/rag/chat`, `/api/rag/search`, `/api/veille/*`, `/api/documents/upload`, `/api/ingestion`. Toute la logique RAG et veille côté back s’exécute ici. |

---

## 3. Base de données (Supabase)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **Supabase** | Hébergement Postgres, Auth, Storage (optionnel pour PDFs). Une seule base pour RAG, veille, conversations. |
| **Postgres** | Tables : `documents`, `chunks`, `sources`, `veille_runs`, `veille_items`, `conversations`, `messages`, `rag_settings`. |
| **pgvector** | Extension pour stocker les **embeddings** (vector 384D) dans `chunks.embedding` (et `chunks.embedding_fr` en bilingue). Index HNSW pour la recherche par similarité cosinus. |
| **FTS (tsvector + GIN)** | Colonnes `chunks.content_tsv` (config english) et, en bilingue, `content_fr_tsv` (config french). Recherche lexicale sur le contenu des chunks. |
| **Supabase Auth** | Login (email / mot de passe) ; session ; accès aux API et aux données protégé par l’utilisateur connecté. |
| **Supabase JS** | `@supabase/supabase-js` + `@supabase/ssr` : client navigateur et serveur pour requêtes, RPC, auth. |

---

## 4. RAG : embeddings, recherche, génération

### 4.1 Embeddings (recherche côté back Node)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **@xenova/transformers** | Chargement du modèle **Xenova/all-MiniLM-L6-v2** (équivalent all-MiniLM-L6-v2) côté **Node** pour embedder la **requête utilisateur** (384D). Même dimension que les chunks en base. Utilisé dans `lib/rag/embed.ts`. |

- **Pourquoi Xenova côté API** : pas d’appel API payant pour l’embedding ; modèle tourne sur le serveur Next (ou le runtime d’exécution des API routes). Aligné avec les vecteurs produits à l’ingestion (Python).

### 4.2 Embeddings (ingestion côté Python)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **sentence-transformers** | Modèle **all-MiniLM-L6-v2** dans le script **scripts/ingest.py** pour encoder le **contenu des chunks** (batch). Vecteurs 384D écrits dans `chunks.embedding`. En bilingue : même modèle sur `content_fr` → `embedding_fr`. |

### 4.3 Recherche (FTS + vector + RRF)

| Élément | Technologie / mise en œuvre | Rôle dans le projet |
|---------|-----------------------------|----------------------|
| **Vector** | RPC Postgres **match_chunks** (et **match_chunks_fr** en bilingue) ; similarité cosinus sur `embedding` (et `embedding_fr`). | Retour des chunks les plus proches sémantiquement de la requête. |
| **FTS** | RPC **search_chunks_fts** (et **search_chunks_fts_fr** en bilingue) ; `plainto_tsquery` sur `content_tsv` / `content_fr_tsv`. | Retour des chunks contenant les termes de la requête (lexical). |
| **Fusion** | **RRF** (Reciprocal Rank Fusion) dans `lib/rag/search.ts` : fusion des deux listes (vector + FTS), paramètres `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k` lus depuis `rag_settings`. | Un seul top-K de chunks pour le contexte envoyé au LLM et pour le garde-fou. |

### 4.4 Génération des réponses

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **OpenAI API** | **Chat Completions** (modèle `gpt-4o-mini`) pour générer la réponse à partir du contexte (chunks) + historique (N derniers messages) + question. Variable d’env **OPENAI_API_KEY**. |
| **Streaming** | `stream: true` dans l’appel OpenAI ; l’API `/api/rag/chat` renvoie un flux (SSE) pour affichage progressif côté front. |

---

## 5. Ingestion des PDF (Python)

| Technologie | Rôle dans le projet |
|-------------|----------------------|
| **PyMuPDF (fitz)** | Lecture des PDF dans **scripts/ingest.py** : extraction du texte par page (`page.get_text()`), métadonnées (XMP, heuristiques). |
| **Tesseract (pytesseract)** + **pdf2image** | **Fallback OCR** : si une page a très peu de caractères (< seuil), conversion en image puis OCR pour récupérer le texte (PDF scannés). **Poppler** est requis pour pdf2image (macOS : `brew install poppler` ; Linux : `apt install poppler-utils`). **Tesseract** doit être installé sur le système (macOS : `brew install tesseract tesseract-lang` ; Linux : `apt install tesseract-ocr tesseract-ocr-eng`). |
| **sentence-transformers** | Encodage des chunks (all-MiniLM-L6-v2, 384D) ; en bilingue, encodage aussi de `content_fr` → `embedding_fr`. |
| **Traduction (prévue)** | Modèle Hugging Face local (ex. Helsinki-NLP/opus-mt-en-fr) pour produire `content_fr` à l’ingestion, sans API payante. |
| **Supabase (client Python)** | Insertion des lignes `documents` et `chunks` ; mise à jour du statut et du log d’ingestion. |
| **python-dotenv** | Chargement de `.env.local` / `.env` pour les clés Supabase (URL, service role). |

---

## 6. Veille (scraping et similarité)

| Technologie | Rôle (actuel ou prévu) |
|-------------|------------------------|
| **HTML / fetch** | Récupération des pages sources (URLs en base). Playwright ou équivalent pour sites avec JS. |
| **Parsing HTML** | BeautifulSoup4 / lxml, trafilatura ou similar pour extraire titre, abstract, DOI (et nettoyer le bloc article avant LLM). |
| **LLM (extraction)** | Appel API (ex. OpenAI) pour extraire métadonnées structurées depuis le HTML (schéma fixe) et filtrer les URLs (pages articles uniquement). |
| **Dédup** | DOI (et fuzzy sur titre si besoin, ex. rapidfuzz) pour éviter doublons ; garde-fous avant envoi au LLM. |
| **Embeddings + similarité** | À terme : embedding des abstracts des items veille, comparaison avec le corpus (pgvector) pour score de pertinence et liste rankée. |

---

## 7. Synthèse : techno → usage

| Techno | Où | Usage |
|--------|-----|-------|
| Next.js + React + TS | Front + API | App web, routes API RAG/veille/documents/ingestion. |
| Supabase (Postgres, Auth) | Back / DB | Données, authentification, RPC. |
| pgvector | DB | Stockage et recherche par similarité des embeddings (chunks). |
| FTS (tsvector, GIN) | DB | Recherche lexicale sur le contenu des chunks (english / french). |
| Xenova/transformers | API Node | Embedding de la requête utilisateur (384D). |
| sentence-transformers | Script Python | Embedding des chunks à l’ingestion (384D). |
| OpenAI | API Node | Génération des réponses RAG (Chat Completions, streaming). |
| PyMuPDF + OCR | Script Python | Extraction texte et métadonnées PDF ; fallback OCR. |
| RRF | lib/rag/search.ts | Fusion des résultats FTS + vector pour un seul top-K. |
| rag_settings (table) | DB + API | Paramètres dynamiques : garde-fou, contexte, recherche hybride, etc. |

---

## 8. Références vers les autres documents

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Besoins, utilisateurs, flows, structure haute. |
| **Back RAG** | API, ingestion, génération, paramétrage, multilingue, conversations (récap par thème et priorité). Fichier : `BACK_RAG.md`. |
| **Fonctionnalités Front** | RAG + Veille côté UI (langue, recherche, garde-fou, streaming). Fichier : `FONCTIONNALITES_FRONT.md`. |
| **Pipeline veille** | Étapes détaillées du scraping et de la veille. Fichier : `PIPELINE_VEILLE_CONSOLIDE.md`. |
| **Schéma DB et données** | Tables, migrations, flows back ↔ DB. Fichier : `SCHEMA_DB_ET_DONNEES.md`. |
