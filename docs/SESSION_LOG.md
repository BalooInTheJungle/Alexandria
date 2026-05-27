# SESSION_LOG — Alexandria

Historique des sessions de développement. Une entrée par session significative.

---

## Session — Mai 2026 (Session 3) — Dataviz + Ingestion bulk

### Objectifs
- Ajouter la dataviz sur la page `/database`
- Corriger la pipeline d'ingestion (297 docs en erreur)
- Ingérer le corpus complet (~15 477 PDFs, 2015-2026)

### Réalisations

**Page `/database` — dataviz complète**
- KPI cards (documents, chunks, taux couverture, taille estimée)
- Word cloud (top 50 termes filtrés du corpus)
- Bar chart horizontal (top termes avec occurrences)
- UMAP scatter plot (jusqu'à 3000 chunks colorés par document)
- Section analytics RAG (daily queries, taux garde-fou, langues)
- Remontée du formulaire upload en haut de page

**Infrastructure analytics**
- Table `query_logs` + RPC `get_query_stats_daily` (`supabase/migrations/20260505130000_query_logs.sql`)
- `lib/db/query-logs.ts` : insertQueryLog (fire-and-forget), getQueryAnalytics
- `app/api/analytics/overview/route.ts` : GET analytics
- Injection log dans `/api/rag/chat` après chaque requête utilisateur

**UMAP 2D**
- Migration `chunks.umap_x / umap_y` (`supabase/migrations/20260505140000_chunks_umap.sql`)
- Script `scripts/compute_umap.py` (UMAP cosine, n_neighbors=15, paginated fetch, batch write)
- API `app/api/corpus/map/route.ts` (sample 3000 points)
- **EXÉCUTÉ avec succès** : 35 584 coordonnées calculées et stockées

**Correction ingestion TypeScript (web upload)**
- `lib/db/chunks.ts` : CHUNK_BATCH_SIZE = 20 (au lieu de bulk)
- `lib/ingestion/index.ts` : boucle par batch de 20 segments

**Script ingestion Python v2 (`scripts/ingest.py`)**
- Récursif sur `data/pdfs/YEAR/` — filtré 2015-2026
- Pas de traduction MarianMT (content_fr = content EN)
- Métadonnées : journal (20+ journaux connus + heuristique), année depuis dossier
- DOI-first dedup + storage_path dedup
- batch=5, retry 3x backoff exponentiel, pause 0.3s
- Handler d'erreur robuste (double try/except)

### Problème bloquant non résolu

**Index HNSW → timeouts persistants** :
- Chaque INSERT chunks déclenche recalcul graphe HNSW → dépasse 30s timeout Supabase
- Le script ingest.py en boucle a surchargé Supabase → SQL Editor lui-même timeout
- **Action requise** (prochaine session) :
  1. S'assurer qu'aucun processus ingest.py ne tourne (`ps aux | grep ingest`)
  2. Attendre récupération Supabase (5-10 min)
  3. Exécuter dans SQL Editor (séparément) :
     ```sql
     DROP INDEX IF EXISTS idx_chunks_embedding;
     DROP INDEX IF EXISTS idx_chunks_embedding_fr;
     ```
  4. Relancer ingest.py avec batch=50
  5. Après ingestion : recréer les index HNSW
  6. Relancer compute_umap.py

### État base de données fin de session
- `documents` : 367 done, 0 pending, 0 error (après reset)
- `chunks` : 35 584 avec embeddings + coordonnées UMAP
- Index HNSW : **présents** (à dropper avant prochaine ingestion bulk)
- PDFs restants à ingérer : ~15 477 (dans `data/pdfs/2015/` → `data/pdfs/2026/`)

### Décisions techniques prises
- D11 : pas de traduction EN→FR pour l'ingestion bulk
- D12 : drop HNSW avant ingestion bulk (procédure documentée dans DECISIONS.md)
- D13 : Supabase Pro (25$/mois) — corpus 2015-2026 uniquement (~7,4 Go)
- D14 : batch=5, retry 3x, pause 0.3s (temporaire, sera batch=50 après drop HNSW)

---

## Session — Mai 2026 (Session 4) — Articles auteur + comparaison corpus

### Objectifs
- Ingérer les 521 articles publiés du chercheur (flag `is_author_article=true`)
- Comparer chaque article auteur avec le corpus général (similarité sémantique)
- Afficher la comparaison dans la page Database
- Corriger la qualité du texte et des embeddings sur tout le corpus

### Réalisations

**Ingestion articles auteur**
- Migration `20260526100000_documents_author_flag.sql` : colonne `is_author_article boolean default false` + index partiel
- `scripts/ingest.py --author` : scan `data/Articles auteur/`, flag `is_author_article=True`, support dossiers `YEAR-NB-CUMUL`
- **521 articles ingérés**, ~85 000 chunks, embeddings 384D
- `scripts/fix_author_titles.py` : 126 titres corrigés (texte espacé → texte lisible, titres binaires → NULL)

**RPC SQL — comparaison corpus**
- `20260526110000_match_corpus_by_author_doc.sql` : PL/pgSQL avg embedding (trop lente, abandonnée)
- `20260526120000_match_corpus_docs_rpc.sql` : SQL function `match_corpus_docs(query_embedding, match_count, chunk_candidates, match_threshold)` — filtre `is_author_article=false`, agrège par document, utilise l'index IVFFlat

**Routes API**
- `GET /api/corpus/author-articles` : liste paginée des articles auteur (page, pageSize, year)
- `GET /api/corpus/author-articles/[id]/similar` : top N corpus similaires via embedding **moyen** de tous les chunks (pas position=0 — voir D16)

**UI — page Database**
- Section "Articles publiés du chercheur — liens avec le corpus"
- Accordion : clic sur un article → charge les N docs corpus similaires
- `SimilarityBadge` coloré (vert ≥80%, jaune ≥60%, gris sinon)
- Cache des résultats déjà chargés (pas de re-fetch)
- Masquage des `best_chunk` avec texte espacé (fonction `isSpacedText`)

**Correction texte espacé — corpus entier**
- `scripts/fix_spaced_chunks.py` : détection SQL (`content ~ '([A-Za-z] {2,4}){10,}'`), fix Python, re-embed, update DB
- **797 379 chunks corrigés** (94% du corpus), 0 erreur
- Trigger `content_tsv` mis à jour automatiquement
- Index IVFFlat reconstruit après correction

**Incidents et résolutions**
- Index `idx_chunks_embedding` **invalide** (corrompu par un CREATE CONCURRENTLY interrompu) → DROP + CREATE CONCURRENTLY via psql (pas SQL Editor → timeout HTTP)
- `CREATE INDEX CONCURRENTLY` impossible dans un bloc transaction → deux `-c` séparés dans psql
- Embeddings de mauvaise qualité (position=0 = header vieux PDF) → passage à la moyenne de tous les embeddings
- `$SUPABASE_DB_URL` non chargée dans le shell terminal → utiliser la valeur littérale ou exporter dans `~/.zshrc`

### État base de données fin de session
- `documents` : ~3 700 corpus + 521 auteur (is_author_article=true)
- `chunks` : **848 857** chunks (dont 797 379 avec contenu et embedding corrigés)
- Index IVFFlat `idx_chunks_embedding` : **valid=t**, 1.3 Go, lists=100
- UMAP : à recalculer (compute_umap.py — nouveau corpus)

### Décisions techniques prises
- D13 (CLAUDE.md) : IVFFlat rebuild via psql, pas SQL Editor (timeout HTTP)
- D15 : Correction rétroactive texte espacé sur 797k chunks (voir DECISIONS.md)
- D16 : Embedding moyen pour comparaison articles auteur (voir DECISIONS.md)

---

## Session — Sessions précédentes

Fonctionnalités core implémentées : RAG hybride bilingue, veille RSS+OpenAlex, scoring, historique conversations, paramètres RAG dynamiques, cron rétention, pipeline veille complète.
Voir `docs/DECISIONS.md` (D1-D10) pour le détail des choix architecturaux.
