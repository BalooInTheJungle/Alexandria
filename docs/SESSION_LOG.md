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

## Session — Sessions précédentes

Fonctionnalités core implémentées : RAG hybride bilingue, veille RSS+OpenAlex, scoring, historique conversations, paramètres RAG dynamiques, cron rétention, pipeline veille complète.
Voir `docs/DECISIONS.md` (D1-D10) pour le détail des choix architecturaux.
