# CLAUDE.md — Alexandria

Outil d'aide à la recherche scientifique : RAG sur corpus PDF + veille automatisée.
Porteur : chercheur CNRS (Molecular Materials & Magnetism). Stack : Next.js 14, Supabase, OpenAI.

---

## Documentation du projet

| Dossier | Contenu |
|---------|---------|
| `docs/` | Vision, architecture, roadmap, décisions, erreurs, glossaire |
| `context/` | État de session, profil de travail, logs |
| `agents/` | Guides spécialisés (session, debug) |
| `skills/` | Recettes réutilisables (composant, migration, source veille) |
| `documentation/` | Docs techniques détaillées (référence complète) |

---

## Façon de travailler avec ce projet

### Implémenter petit à petit
Toujours découper en petits blocs : **un fichier à la fois, une fonctionnalité à la fois**. Proposer le découpage avant de commencer, attendre la validation entre chaque étape.

### Logs obligatoires
Sur **chaque fonction** de `lib/` et chaque **API route** :

```ts
console.log('[searchChunks] input:', { query, lang, matchCount })
console.log('[searchChunks] result:', { chunksFound: chunks.length, bestSimilarity })
console.error('[searchChunks] error:', error)
```

### Langue
- Code, commentaires, variables, logs : **anglais**
- Réponses dans le terminal : **français**

---

## Commandes essentielles

```bash
npm run dev        # Next.js dev (http://localhost:3000)
npm run build      # Build production
npm run lint       # ESLint

# Ingestion PDF bulk (Python) — corpus data/pdfs/YEAR/
cd scripts && python3 ingest.py

# Calcul UMAP 2D sur tous les chunks (à relancer après chaque ingestion bulk)
cd scripts && python3 compute_umap.py

# Migrations Supabase
npx supabase db push

# Rétention manuelle
curl -H "Authorization: Bearer $CRON_SECRET" "https://<domaine>/api/cron/retention"
```

### ⚠️ Avant toute ingestion bulk (> 100 docs) — DROP les index HNSW

Sans cette étape, chaque INSERT dépasse le timeout Supabase (30s) à cause du recalcul du graphe HNSW.

```sql
-- Dans Supabase SQL Editor — AVANT l'ingestion
DROP INDEX IF EXISTS idx_chunks_embedding;
DROP INDEX IF EXISTS idx_chunks_embedding_fr;

-- APRÈS l'ingestion complète — recréer les index
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX idx_chunks_embedding_fr ON chunks USING hnsw (embedding_fr vector_cosine_ops) WITH (m=16, ef_construction=64);
```

**Prérequis système (ingestion Python) :**
- macOS : `brew install poppler tesseract tesseract-lang`
- Linux : `apt install poppler-utils tesseract-ocr tesseract-ocr-eng`

---

## Variables d'environnement

Copier `.env.example` → `.env.local` et remplir. Voir `.env.example` pour le détail.

| Variable | Usage |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase (app + script Python) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client navigateur et serveur |
| `SUPABASE_SERVICE_ROLE_KEY` | Script Python + cron/retention (admin) |
| `OPENAI_API_KEY` | Génération RAG (`gpt-4o-mini`) — serveur uniquement |
| `CRON_SECRET` | Protection des routes `/api/cron/*` |

---

## Architecture (résumé)

Next.js 14 (App Router, TypeScript) mono-repo :
- **Supabase** : Postgres + pgvector + Auth (cloud, pas d'on-prem)
- **OpenAI** : `gpt-4o-mini`, streaming SSE pour les réponses RAG
- **@xenova/transformers** : embeddings 384D côté Node (même modèle que l'ingestion Python)
- **scripts/ingest.py** : ingestion PDF séparée (sentence-transformers + MarianMT EN→FR)

### Structure des modules

```
app/
  (auth)/login/            # Login Supabase Auth
  (dashboard)/
    rag/                   # Page chatbot RAG + settings
    bibliographie/         # Veille + upload documents
  api/
    rag/chat/              # POST : requête RAG, streaming SSE
    rag/search/            # Recherche hybride seule
    rag/conversations/     # GET liste, PATCH titre, DELETE
    rag/conversations/[id]/messages/   # GET messages (cursor pagination)
    rag/settings/          # GET + PATCH rag_settings
    veille/scrape/         # POST : déclencher une run
    veille/list/           # GET : items du dernier run, triés par score
    veille/status/[runId]/ # GET : statut run (polling)
    documents/upload/      # Upload PDF → data/pdfs/ + insert documents
    ingestion/             # Parse → chunk → embed
    cron/retention/        # GET : suppression conversations > 30 jours
    cron/veille/           # GET : pipeline veille quotidien (6h UTC)

lib/
  supabase/                # client.ts (browser), server.ts, admin.ts
  db/                      # Requêtes DB + types TypeScript
  rag/                     # detect-lang, search, embed, openai, citations,
                           # conversation-persistence, settings, rerank
  veille/                  # sources, fetch, extract, guardrails, score, pipeline
  ingestion/               # parse-pdf, chunk, index

components/
  rag/                     # RagConversationSidebar, RagMessageList
  veille/                  # VeilleDashboard, VeilleArticleCard
  ui/                      # shadcn/ui : button, card, dialog, input...

scripts/
  ingest.py                # Ingestion PDF (Python, manuel)
  import-sources.ts        # Upsert des 43 sources en DB
  test-veille.ts           # Test pipeline veille

supabase/migrations/       # 14 migrations SQL (ordre chronologique)
data/pdfs/                 # PDFs à indexer (non versionnés)
```

### Pipeline RAG (flux d'une requête)

1. `POST /api/rag/chat` reçoit `{ query, conversationId?, stream? }`
2. `detect-lang.ts` → `'fr' | 'en'`
3. Lecture `rag_settings` depuis Supabase
4. Embedding de la requête (Xenova 384D)
5. Recherche hybride : RPC `match_chunks` + `search_chunks_fts` → fusion RRF
   - FR : `match_chunks_fr` + `search_chunks_fts_fr` ; fallback FR→EN si pas de chunks FR
6. Garde-fou : `bestVectorSimilarity < similarity_threshold` → retour `guard_message`, pas d'appel OpenAI
7. `openai.ts` avec contexte + historique + instruction langue → réponse streaming SSE
8. Persistance : `messages` (user + assistant) + `conversations.updated_at`

### Pipeline Veille

Déclenchée par bouton UI ou cron Vercel (6h UTC) :
1. `createRun()` → `veille_runs` avec `status=running`
2. Sources RSS (43 journaux) → titre, DOI, abstract, auteurs — filtre 7 jours — dédup DOI
3. Enrichissement OpenAlex en batch (abstracts manquants ACS)
4. Sources OpenAlex directes (MDPI et similaires)
5. Insert par batch de 50 → `scoreVeilleItems()` → embed abstract → `match_chunks` → `similarity_score`
6. `completeRun(runId, 'completed'|'failed')`

### Base de données — points critiques

- `chunks.embedding` et `chunks.embedding_fr` : `vector(384)` — **dimension fixe, ne jamais changer**
- `content_tsv` / `content_fr_tsv` : tsvector maintenus par triggers Postgres (ne pas écrire directement)
- RPC en base : `match_chunks`, `match_chunks_fr`, `search_chunks_fts`, `search_chunks_fts_fr`
- RLS activé sur toutes les tables — client admin uniquement pour cron/ingestion
- `rag_settings` relu à **chaque requête chat** — c'est le mécanisme de paramétrage dynamique
- Migrations dans `supabase/migrations/` à appliquer dans l'ordre chronologique

### Clients Supabase

| Fichier | Client | Usage |
|---------|--------|-------|
| `lib/supabase/client.ts` | Browser | Composants client |
| `lib/supabase/server.ts` | Server (cookies) | API routes (RLS authenticated) |
| `lib/supabase/admin.ts` | Service role | Cron, ingestion |

### Déploiement Vercel

- `vercel.json` : cron `GET /api/cron/retention` à 4h UTC, `GET /api/cron/veille` à 6h UTC
- `OPENAI_API_KEY` : uniquement des caractères ASCII imprimables (sanitisation déjà en place)
- `maxDuration=300` sur la route veille (pipeline longue)

---

## État actuel (mai 2026)

| Fonctionnalité | État |
|---------------|------|
| RAG chat (FR + EN, streaming, garde-fou) | ✅ Fonctionnel |
| Conversations + historique | ✅ Fonctionnel |
| Paramètres RAG (rag_settings) | ✅ Fonctionnel |
| Pipeline veille (RSS + OpenAlex + scoring) | ✅ Fonctionnel |
| Cron rétention 30 jours | ✅ Fonctionnel |
| Page Database — dataviz (KPIs, UMAP, analytics) | ✅ Fonctionnel |
| Logs requêtes RAG (query_logs) | ✅ Fonctionnel |
| Upload PDF + ingestion | ⚠️ À vérifier |
| **Ingestion bulk ~15 477 PDFs (2015-2026)** | 🔴 En attente — bloquer sur drop HNSW |
| Interface front (composants, layout) | ⚠️ À adapter |

### Corpus actuel en base
- **367 documents** ingérés, status=done
- **35 584 chunks** avec embeddings EN + FR (embedding_fr = embedding EN sans traduction)
- **35 584 coordonnées UMAP** calculées (compute_umap.py exécuté)
- **~15 477 PDFs** à ingérer dans `data/pdfs/2015/` → `data/pdfs/2026/`

### Limite stockage Supabase
- Plan **Pro (25$/mois)** activé — limite ~8 Go DB
- Corpus retenu : **2015-2026 uniquement** (~7,4 Go PDFs)
- 2000-2014 exclus (~5,6 Go supplémentaires, hors budget)

Voir `docs/ROADMAP.md` pour les prochaines étapes.
