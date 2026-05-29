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

# Ingestion PDF bulk (Python) — corpus data/pdfs2/YEAR/
cd scripts && python3 ingest.py

# Ingestion articles auteur (data/Articles auteur/)
cd scripts && python3 ingest.py --author

# Correction titres espacés articles auteur (après ingestion --author)
cd scripts && python3 fix_author_titles.py --apply

# Correction texte espacé dans les chunks (dry-run d'abord, puis apply)
cd scripts && python3 fix_spaced_chunks.py --dry-run
cd scripts && python3 fix_spaced_chunks.py --apply

# Calcul UMAP 2D sur tous les chunks (à relancer après chaque ingestion bulk)
cd scripts && python3 compute_umap.py

# Migrations Supabase
npx supabase db push

# Rétention manuelle
curl -H "Authorization: Bearer $CRON_SECRET" "https://<domaine>/api/cron/retention"
```

### ⚠️ Rebuild index via psql (pas SQL Editor — timeout HTTP à 30s)

```bash
# Toujours utiliser psql directement, jamais le SQL Editor Supabase pour les opérations longues
psql "postgresql://postgres:<PASSWORD>@db.<REF>.supabase.co:5432/postgres" \
  -c "SET statement_timeout = 0;" \
  -c "DROP INDEX CONCURRENTLY IF EXISTS idx_chunks_embedding;" \
  -c "CREATE INDEX CONCURRENTLY idx_chunks_embedding ON public.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);"

# Suivi progression
psql "..." -c "SELECT phase, blocks_done, blocks_total,
  round(blocks_done::numeric / nullif(blocks_total,0) * 100, 1) AS pct
  FROM pg_stat_progress_create_index WHERE relid = 'public.chunks'::regclass;"
```

> **Piège** : `CREATE INDEX CONCURRENTLY` ne peut pas tourner dans un bloc transaction.
> Utiliser deux `-c` séparés (pas `SET ...; CREATE ...` dans un seul `-c`).
> `$SUPABASE_DB_URL` n'est pas chargée dans le shell — utiliser la valeur littérale ou `export` dans `~/.zshrc`.

### ⚠️ Après toute ingestion bulk (> 50k chunks) — REBUILD l'index IVFFlat

L'index IVFFlat utilise des clusters fixes. Après beaucoup d'inserts, les nouveaux vecteurs tombent dans les mauvais clusters → les requêtes passent de ~50ms à 16s+. Reconstruire après chaque ingestion bulk.

```sql
-- Dans Supabase SQL Editor — APRÈS l'ingestion complète
-- (ingest.py le fait automatiquement, mais si ingestion manuelle ou partielle :)
DROP INDEX CONCURRENTLY IF EXISTS idx_chunks_embedding;
CREATE INDEX CONCURRENTLY idx_chunks_embedding
  ON public.chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Idem pour l'index FR si utilisé
DROP INDEX CONCURRENTLY IF EXISTS idx_chunks_embedding_fr;
CREATE INDEX CONCURRENTLY idx_chunks_embedding_fr
  ON public.chunks
  USING ivfflat (embedding_fr vector_cosine_ops)
  WITH (lists = 100);
```

> **Durée** : ~5-15 minutes sur 600k chunks. `CONCURRENTLY` = DB reste opérationnelle.
> **Suivi** : `SELECT phase, blocks_done, blocks_total FROM pg_stat_progress_create_index WHERE relid = 'public.chunks'::regclass;`

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
  ingest.py                # Ingestion PDF (Python, manuel) — flag --author pour articles auteur
  fix_author_titles.py     # Correction titres espacés des articles auteur (--dry-run / --apply)
  fix_spaced_chunks.py     # Correction texte espacé dans chunks + re-embed (--dry-run / --apply)
  import-sources.ts        # Upsert des 43 sources en DB
  test-veille.ts           # Test pipeline veille
  compute_umap.py          # Calcul coordonnées UMAP 2D sur les chunks

supabase/migrations/       # 16 migrations SQL (ordre chronologique)
data/pdfs/                 # PDFs corpus (non versionnés)
data/pdfs2/                # PDFs réorganisés par année de publication
data/Articles auteur/      # PDFs articles publiés du chercheur (non versionnés)
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

Déclenchée par bouton UI (`/api/veille/scrape`) ou cron GitHub Actions (2h Paris → `/api/cron/veille`) :
1. `createRun()` → `veille_runs` avec `status=running`
2. Sources RSS (43 journaux) → titre, DOI, abstract, auteurs — filtre 7 jours — dédup DOI
3. Enrichissement OpenAlex en batch (abstracts manquants ACS)
4. Sources OpenAlex directes (MDPI et similaires)
5. Insert par batch de 50 → `scoreVeilleItems()` → embed abstract → `match_chunks` → `similarity_score`
6. Cap `MAX_ITEMS = 1000` — scoring des 1000 articles les plus récents (~40 min sur Hobby)
7. Résumé IA : top 8 articles (≥30%) → GPT-4o-mini → `saveRunSummary()` (timeout 120s)
8. `completeRun(runId, 'completed'|'failed')`

> **`waitUntil`** (`@vercel/functions`) sur les deux routes — répond immédiatement, pipeline en background.
> **Fallback** : si GPT échoue, `high_score_count` est sauvegardé sans `ai_summary`.

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

### Déploiement Vercel + GitHub Actions

- `vercel.json` : cron `GET /api/cron/retention` à 4h UTC (rétention)
- **Cron veille** : GitHub Actions (`.github/workflows/veille-cron.yml`) — 0h UTC (2h Paris) → appelle `/api/cron/veille`
  - Secrets GitHub requis : `CRON_SECRET`, `VERCEL_APP_URL` (= `https://alexandria-dusky.vercel.app`)
- `OPENAI_API_KEY` : uniquement des caractères ASCII imprimables (sanitisation déjà en place)
- Plan Hobby : pas de `maxDuration` — pipeline tourne via `waitUntil` (~40 min, Vercel le supporte)

---

## État actuel (mai 2026)

| Fonctionnalité | État |
|---------------|------|
| RAG chat (EN, streaming, garde-fou) | ✅ Fonctionnel |
| Conversations + historique | ✅ Fonctionnel |
| Paramètres RAG (rag_settings) | ✅ Fonctionnel |
| Pipeline veille (RSS + OpenAlex + scoring) | ✅ Fonctionnel |
| Sélecteur seuil veille (20→70%, défaut 30%) | ✅ Fonctionnel |
| Résumé IA veille (GPT-4o-mini, top 8 articles ≥30%) | ✅ Fonctionnel |
| Cron veille automatique (GitHub Actions, 2h Paris) | ✅ Fonctionnel |
| Résumé IA sur page détail run historique | ✅ Fonctionnel |
| Cron rétention 30 jours | ✅ Fonctionnel |
| Page Database — dataviz (KPIs, UMAP, analytics) | ✅ Fonctionnel |
| Logs requêtes RAG (query_logs) | ✅ Fonctionnel |
| Articles auteur indexés (521 docs, is_author_article) | ✅ Fonctionnel |
| Comparaison articles auteur ↔ corpus | ✅ Fonctionnel |
| Correction texte espacé (797k chunks re-embeddés) | ✅ Terminé |
| Upload PDF + ingestion | ⚠️ À vérifier |
| UMAP sur nouveau corpus | ⏳ À relancer (compute_umap.py) |

### Corpus actuel en base
- **~3 700 documents corpus** (2024 + 2025 + 2026) + **521 articles auteur** (`is_author_article=true`)
- **848 857 chunks** avec embeddings EN (384D) — **tous corrigés** (fix_spaced_chunks.py)
- **Index IVFFlat** `idx_chunks_embedding` (lists=100) — valid=t, 1.3 Go
- UMAP non recalculé sur ce corpus (à faire — compute_umap.py)
- **Titres nettoyés** : `fix_spaced_text()` à l'ingestion + `fix_author_titles.py` sur 521 articles auteur

### Structure PDFs
- `data/pdfs/YEAR/` — organisation par année d'acquisition (original)
- `data/pdfs2/YEAR/` — organisation par **année de publication** (via `reorganize_pdfs.py`)
- `data/Articles auteur/YEAR/` — articles publiés du chercheur
- L'ingestion incrémentale utilise `data/pdfs2/` depuis mai 2026

### Ingestion
- `scripts/ingest.py` crée l'index IVFFlat automatiquement via psycopg2 après tous les inserts
- `scripts/ingest.py --author` pour les articles auteur (`data/Articles auteur/`)
- Source corpus : `PDF_DIR = data/pdfs2/`, `YEAR_MIN, YEAR_MAX` dans `main()`
- Dédup automatique par DOI puis par storage_path — safe à relancer
- Pour ingestion complète : `TRUNCATE chunks, documents`, modifier années, `python3 ingest.py`
- **Après ingestion bulk (>50k chunks)** : rebuild IVFFlat via psql (pas SQL Editor)

### Qualité des embeddings
- `scripts/fix_spaced_chunks.py` : détecte et corrige le texte espacé dans les chunks
- **Exécuté** sur 797k chunks en mai 2026 — à relancer avec `--dry-run` après chaque nouvelle ingestion bulk
- La route `/similar` utilise la **moyenne de tous les embeddings** (pas position=0) pour éviter les faux positifs sur headers de PDF

### Limite stockage Supabase
- Plan **Pro (25$/mois)** activé — limite ~8 Go DB
- DB actuelle : **~7 Go** après correction des embeddings
- Marge : ~1 Go pour étendre le corpus si besoin

Voir `docs/ROADMAP.md` pour les prochaines étapes.
