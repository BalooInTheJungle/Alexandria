# CLAUDE.md — Alexandria

Outil d'aide à la recherche scientifique : veille automatisée + lecture assistée + analyse approfondie sur corpus PDF.
Porteur : chercheur CNRS (Molecular Materials & Magnetism). Stack : Next.js 14, Supabase, OpenAI.

**3 modules actifs :**
- **Veille** — 44 sources RSS + Semantic Scholar, scoring sémantique quotidien, synthèse IA
- **Lecture assistée** — upload PDF → résumé structuré + discussion IA + citations cliquables + PDF scroll sync
- **Analyse** — proximité corpus + références croisées + recommandations Semantic Scholar + intégration corpus

> ⚠️ Le chatbot RAG (`/rag`) a été retiré du front en juin 2026. La tuyauterie (`lib/rag/`, `/api/rag/`) reste pour les routes Analyse.

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

# Après ingestion --author : recalculer les représentants Semantic Scholar (prend ~90s)
export $(grep -v '^#' .env.local | xargs)
npx tsx scripts/compute-ss-representatives.ts

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
| `OPENAI_API_KEY` | GPT-4o-mini : insights Analyse + synthèse veille |
| `CRON_SECRET` | Protection des routes `/api/cron/*` |
| `SS_API_KEY` | Semantic Scholar (optionnel) — sans clé : 1 req/s |

---

## Architecture (résumé)

Next.js 14 (App Router, TypeScript) mono-repo :
- **Supabase** : Postgres + pgvector + Auth + Storage bucket "analyses" (cloud, pas d'on-prem)
- **OpenAI** : `gpt-4o-mini` — insights Analyse (résumé + synthèse veille)
- **@xenova/transformers** : embeddings 384D côté Node (all-MiniLM-L6-v2, même modèle que l'ingestion Python)
- **scripts/ingest.py** : ingestion PDF bulk (sentence-transformers, sans traduction FR)
- **Semantic Scholar API** : recommandations + métadonnées références citées

### Structure des modules

```
app/
  /                        # Landing page publique FR/EN
  (auth)/login/            # Login Supabase Auth
  (dashboard)/
    bibliographie/         # Veille : articles ≥75%, historique runs, sources
    database/              # KPIs corpus, UMAP, analytics, comparaison articles auteur
    analyse/               # Liste analyses + upload PDF
    analyse/[id]/          # 4 onglets : Proximité / Résumé / Discussion / Aller plus loin
  api/
    analyse/upload/        # POST : upload PDF → parse → chunk → embed → document_analyses
    analyse/[id]/insights/ # GET : résumé GPT + corpus_refs + cited_refs + ss_recs (avec cache)
    analyse/[id]/chat/     # POST : discussion IA streaming SSE (doc + corpus)
    analyse/[id]/pdf/      # GET : URL signée Supabase Storage (1h)
    analyse/[id]/integrate/ # POST : is_temp=false → intégration corpus permanente
    analyse/[id]/suggestions/ # GET : 4 suggestions hardcodées
    analyse/warmup/        # GET : warm-up Xenova avant première question
    veille/list/           # GET : items du dernier run complété
    veille/runs/           # GET : liste des runs avec counts
    veille/runs/[id]/      # GET : détail run (pipeline_logs, ai_summary…)
    veille/items/top/      # GET : articles ≥75% toutes runs, paginés — Cache-Control: no-store
    veille/items/[id]/     # PATCH : toggle read_at (lu/non lu)
    veille/stats/          # GET : KPIs globaux — Cache-Control: no-store
    cron/retention/        # GET : suppression conversations > 30 jours
    rag/*                  # Legacy — tuyauterie conservée, page front retirée

lib/
  supabase/                # client.ts (browser), server.ts, admin.ts
  rag/                     # embed.ts (Xenova 384D), search.ts, openai.ts, citations.ts — réutilisés par Analyse
  veille/                  # sources, fetch-rss, openalex, crossref, score, summarize, filter-article-display
  ingestion/               # parse-pdf.ts, chunk.ts, index.ts

components/
  analyse/                 # AnalysisChatPanel.tsx, AnalysisPdfViewer.tsx
  veille/                  # VeilleDashboard, VeilleArticleCard
  dashboard/               # NavLinks.tsx
  ui/                      # shadcn/ui : button, card, dialog, input...

scripts/
  ingest.py                # Ingestion PDF bulk (Python) — flag --author pour articles auteur
  fix_author_titles.py     # Correction titres espacés articles auteur (--dry-run / --apply)
  fix_spaced_chunks.py     # Correction texte espacé dans chunks (--dry-run / --apply)
  compute_umap.py          # Calcul coordonnées UMAP 2D sur les chunks
  compute-ss-representatives.ts  # Calcul articles auteur représentatifs (pour SS recs veille)
  import-sources.ts        # Upsert des 44 sources en DB
  veille/
    extract.ts             # Job 1 — fetch RSS + OpenAlex, filtre finalisation
    extract-semanticscholar.ts  # Job 1b — recs SS (si ENABLE_SEMANTIC_SCHOLAR=true)
    score.ts               # Job 2 — embed abstracts → match_chunks → similarity_score
    recap-articles.ts      # Job 3 — GPT analyse individuelle ≥80%
    recap-global.ts        # Job 4 — GPT synthèse globale, marque run completed

supabase/migrations/       # 50 migrations SQL (ordre chronologique)
data/pdfs2/                # PDFs corpus réorganisés par année de publication
data/Articles auteur/      # PDFs articles publiés du chercheur (non versionnés)
```

### Pipeline Analyse (flux upload → discussion)

1. Upload PDF → `POST /api/analyse/upload` → `document_analyses` (status=ready) + chunks `is_temp=true`
2. `GET /api/analyse/[id]/insights` → parallèle : résumé GPT + corpus_refs + cited_refs SS + ss_recs
3. Page `/analyse/[id]` → 4 onglets (Proximité / Résumé / Discussion / Aller plus loin)
4. Discussion : `POST /api/analyse/[id]/chat` → SSE (sources d'abord, puis tokens)
5. Intégration : `POST /api/analyse/[id]/integrate` → `is_temp=false`

### Pipeline Veille

Déclenchée par cron GitHub Actions **7h UTC (9h Paris)** — 4 jobs séquentiels sur `main` :

#### Job 1 — `scripts/veille/extract.ts`
1. `createRun()` → `veille_runs` avec `status=running`
2. **44 sources RSS** → fetch parallèle (concurrence=5) — fenêtre **7 jours**
3. **Filtre de finalisation** : seuls les articles publiés définitivement sont gardés
   - DOI requis → vérification `is_final` via **OpenAlex batch** (1 requête pour tous les DOIs)
   - CrossRef fallback si OpenAlex ne confirme pas
   - Rejet : articles ASAP, preprints, corrections, sans abstract
4. **Sources OpenAlex directes** (MDPI : Magnetochemistry, Inorganics…) — même filtre CrossRef
5. Dédup DOI en mémoire (+ 0 DOI connu en DB au premier run après nettoyage)
6. Insert par batch de 50 → `veille_items` (~638 articles/jour typique)
7. Écrit `run_id` dans `$GITHUB_OUTPUT` pour les jobs suivants

#### Job 2 — `scripts/veille/score.ts`
1. Charge tous les articles avec `similarity_score IS NULL` (auto-reprise si restart)
2. Pour chaque article avec abstract > 50 chars :
   - `embedQuery(abstract)` → vecteur 384D via `@xenova/transformers` (all-MiniLM-L6-v2)
   - `match_chunks RPC` → top-3 chunks les plus proches du corpus → `similarity_score` (top-1)
   - `corpus_refs` : chunks avec similarité ≥ 75% sauvegardés pour affichage
3. Timeout `match_chunks` : 30s — si timeout → `similarity_score = 0` (jamais NULL après scoring)
4. Sauvegarde en batch de 50
5. Résultat typique : ~637 scorés | ~20 ≥75% | ~3-8 ≥80%

#### Job 3 — `scripts/veille/recap-articles.ts`
1. Charge les articles avec `similarity_score ≥ 80%` (tous, pas de cap)
2. GPT-4o-mini → `ai_analysis` par article : `{ contribution, relevance, corpus_link }`
3. Sauvegarde dans `veille_items.ai_analysis` pour chaque article

#### Job 4 — `scripts/veille/recap-global.ts`
1. Charge les articles avec `ai_analysis IS NOT NULL` et `similarity_score ≥ 80%`
2. GPT-4o-mini → `{ themes[], synthesis }` — synthèse en vouvoiement, ton direct
3. Fusionne avec les `ai_analysis` déjà en base → `ai_summary` complet dans `veille_runs`
4. Marque le run `status=completed`, `phase=done`

#### Seuils importants
| Seuil | Valeur | Usage |
|-------|--------|-------|
| Lookback RSS | 7 jours | Fenêtre de recherche articles récents |
| Finalisation | `is_final=true` | Filtre ASAP/preprints (OpenAlex + CrossRef) |
| Scoring corpus | ≥ 0% | Tous les articles avec abstract sont scorés |
| `corpus_refs` | ≥ 75% | Passages corpus affichés dans les cards |
| Affichage "top" | ≥ 75% | Page `/bibliographie` tab Veille |
| Analyse IA | **≥ 80%** | Articles envoyés à GPT pour ai_analysis |
| Stats "pertinents" | ≥ 75% | KPI global de la page |

#### Job 1b — `scripts/veille/extract-semanticscholar.ts` (optionnel)
Activé si variable repo GitHub `ENABLE_SEMANTIC_SCHOLAR=true`. Tourne en parallèle du Job 1.
1. Charge les `ss_paper_id` depuis `ss_representative_papers` (pré-calculés par `compute-ss-representatives.ts`)
2. Appelle `POST /recommendations/v1/papers/` → top 100 papers récents (60j) similaires aux articles auteur
3. Filtre abstract < 50 chars + dédup DOI vs items existants
4. Insert dans `veille_items` avec `source_type='semantic_scholar'`
5. Fusionne ses logs dans `pipeline_logs` du run (préfixe `ss/`)

**Pré-requis** : `compute-ss-representatives.ts` doit avoir été lancé au moins une fois après `ingest.py --author`.
Clé API SS optionnelle (`SS_API_KEY`) — sans clé : limite 1 req/s (rate limit fréquent).

#### Stratégie active / rollback
Le workflow supporte deux stratégies via `VEILLE_STRATEGY` (secret GitHub) :
- `actions` (défaut) — les 4 jobs Node.js décrits ci-dessus + Job 1b optionnel
- `legacy` — appel HTTP vers `/api/cron/veille` sur Vercel (obsolète, Hobby 10s timeout)

> **Secrets GitHub requis** : `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`
> **Variables repo GitHub** : `ENABLE_SEMANTIC_SCHOLAR=true` (optionnel)
> **Durée typique** : ~6-8 min (extract 1min + score 3min + recap-articles 1.5min + recap-global 30s)

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

- `vercel.json` : cron `GET /api/cron/retention` à 4h UTC (rétention conversations)
- **Cron veille** : GitHub Actions `.github/workflows/veille-cron.yml` — **7h UTC (9h Paris)**, stratégie `actions`
  - Secrets GitHub requis : `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`
  - Secret optionnel : `VEILLE_STRATEGY` (override `actions`/`legacy`), `CRON_SECRET`, `VERCEL_APP_URL`
- `OPENAI_API_KEY` : uniquement des caractères ASCII imprimables (sanitisation déjà en place)
- Le pipeline veille tourne entièrement dans GitHub Actions — Vercel n'est plus impliqué dans le scoring

---

## État actuel (juin 2026)

| Fonctionnalité | État |
|---------------|------|
| Pipeline veille GitHub Actions (4 jobs séquentiels) | ✅ ~7min/run, 638 articles/jour |
| Filtre finalisation (OpenAlex + CrossRef) | ✅ exclut ASAP/preprints |
| Scoring sémantique (Xenova 384D) | ✅ ~637 scorés, ~3-8 ≥80%/jour |
| Analyse IA articles ≥80% (ai_analysis jsonb) | ✅ tous analysés |
| Synthèse globale du jour (ai_summary) | ✅ thèmes + synthèse directe |
| Cron veille automatique (GitHub Actions, 9h Paris) | ✅ 7h UTC |
| Page Veille — articles ≥75%, paginés, lu/non lu | ✅ |
| Page Historique — 1 ligne/run, KPIs | ✅ |
| Page détail run — thèmes, articles, logs modal | ✅ |
| Cron rétention 30 jours | ✅ |
| Page Database — KPIs, UMAP, analytics, articles auteur | ✅ |
| Articles auteur indexés (521 docs, is_author_article) | ✅ |
| Source Semantic Scholar (Job 1b) | ✅ activer via `ENABLE_SEMANTIC_SCHOLAR=true` |
| Badge source RSS / Semantic Scholar sur les cards | ✅ |
| Page publique `/` (landing FR/EN) | ✅ accessible sans connexion |
| **Module Analyse — Upload PDF** | ✅ parse + chunk + embed + Storage |
| **Module Analyse — Insights** (résumé + corpus + cited_refs + ss_recs) | ✅ calcul parallèle avec cache |
| **Module Analyse — Discussion IA** | ✅ chat streaming, citations [N], scroll PDF sync |
| **Module Analyse — Intégration corpus** | ✅ is_temp=false en 1 clic |
| Chatbot RAG (`/rag`) | ❌ retiré du front (juin 2026) — DB vidée |
| UMAP recalculé sur corpus actuel | ⏳ à relancer (`compute_umap.py`) |

### Corpus actuel en base
- **~3 700 documents corpus** (2024 + 2025 + 2026) + **521 articles auteur** (`is_author_article=true`)
- **848 857 chunks** avec embeddings EN (384D) — **tous corrigés** (fix_spaced_chunks.py)
- **Index IVFFlat** `idx_chunks_embedding` (lists=100) — valid=t, 1.3 Go
- UMAP non recalculé sur ce corpus (à faire — compute_umap.py)
- **Titres nettoyés** : `fix_spaced_text()` à l'ingestion + `fix_author_titles.py` sur 521 articles auteur

### Veille — état en base (juin 2026)
- `veille_items` : colonnes `read_at timestamptz` + `ai_analysis jsonb` + `similarity_score float` + `corpus_refs jsonb`
- `ai_analysis` structure : `{ contribution: string, relevance: string, corpus_link: string }`
- `corpus_refs` structure : `[{ doc_title, excerpt, page, similarity }]` — passages corpus ≥75% ayant déclenché le score
- `similarity_score = 0` si scoring tenté mais aucun match (jamais NULL après scoring, NULL = pas encore scoré)
- `ai_analysis` rempli uniquement pour les articles ≥80% par `recap-articles.ts`
- **DB nettoyée le 09/06/2026** — runs propres avec nouvelle pipeline : ~638 extraits, ~637 scorés, ~3-8 ≥80%, tous analysés IA

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
