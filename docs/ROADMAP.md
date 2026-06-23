# ROADMAP — Alexandria

Plan d'évolution. Mettre à jour à chaque jalon atteint.

---

## V1 — Socle RAG fonctionnel ✅ (terminé — Fév. 2026)

**Objectif** : interroger le corpus scientifique de façon fiable.

| Fonctionnalité | État |
|---------------|------|
| Ingestion PDF Python (parse + chunk + embed EN 384D) | ✅ |
| Recherche hybride FTS + vector + RRF | ✅ |
| Garde-fou hors domaine (similarity_threshold) | ✅ |
| Génération réponse streaming SSE (gpt-4o-mini) | ✅ |
| Conversations + historique (pagination cursor) | ✅ |
| Paramètres RAG dynamiques (rag_settings) | ✅ |
| Cron rétention 30 jours | ✅ |
| Auth Supabase (login/logout) | ✅ |
| Pipeline veille RSS + OpenAlex + scoring | ✅ |

> **Note** : Le chatbot RAG a été retiré du front en juin 2026 (page `/rag` supprimée, DB vidée).
> La tuyauterie technique (lib/rag/*, /api/rag/*) reste en place et est réutilisée par le module Analyse.

---

## V1.5 — Interface & Veille ✅ (terminé — Mars 2026)

**Objectif** : rendre l'application utilisable au quotidien.

| Fonctionnalité | État |
|---------------|------|
| Navigation header (tabs + layout dashboard) | ✅ |
| Page Bibliographie : cards articles, seuil 75%, filtre lu/non lu | ✅ |
| Page Historique runs : 1 ligne/run, date+heure, KPIs | ✅ |
| Page détail run : thèmes, articles, logs modal, ai_analysis, corpus_refs | ✅ |
| Pipeline veille avec synthèse IA quotidienne | ✅ |
| Page Database : KPIs, word cloud, UMAP scatter, analytics | ✅ |
| Page Sources : gestion active/inactive | ✅ |

---

## V1.6 — Ingestion bulk corpus ✅ (terminé — Avr. 2026)

**Objectif** : ingérer le corpus récent (2024-2026) avec index pgvector opérationnel.

| Étape | État |
|-------|------|
| Script ingest.py v3 (récursif, YEAR_MIN/MAX, IVFFlat auto) | ✅ |
| Réorganisation PDFs par année publication (`data/pdfs2/YEAR/`) | ✅ |
| Ingestion 2024-2026 : ~3 700 documents | ✅ |
| Index IVFFlat `idx_chunks_embedding` (lists=100) — 1.3 Go | ✅ |
| Correction texte espacé : `fix_spaced_chunks.py` sur 797k chunks | ✅ |
| `fix_spaced_text()` intégré dans ingest.py (correction à l'extraction) | ✅ |

---

## V1.7 — Articles auteur + comparaison corpus ✅ (terminé — Mai 2026)

**Objectif** : indexer les articles publiés du chercheur et visualiser leurs liens avec le corpus.

| Étape | État |
|-------|------|
| Flag `is_author_article` sur documents | ✅ |
| Ingestion 521 articles auteur (`ingest.py --author`) | ✅ |
| Correction 126 titres espacés (`fix_author_titles.py`) | ✅ |
| RPC `match_corpus_docs` | ✅ |
| UI Database — section comparaison articles auteur | ✅ |
| Rebuild IVFFlat sur 848k chunks | ✅ |

---

## V1.8 — Semantic Scholar + Landing page ✅ (terminé — Juin 2026)

**Objectif** : étendre la couverture de la veille + créer une page publique.

| Étape | État |
|-------|------|
| Job 1b : source Semantic Scholar (recommandations basées sur articles auteur) | ✅ |
| `compute-ss-representatives.ts` : calcul articles auteur représentatifs | ✅ |
| Table `ss_representative_papers` + RPC `get_author_representative_titles_v2` | ✅ |
| Flag `ENABLE_SEMANTIC_SCHOLAR` (variable repo GitHub) | ✅ |
| Badge source sur VeilleArticleCard (RSS vs Semantic Scholar) | ✅ |
| Page publique `/` (landing FR/EN) | ✅ |
| Middleware : `/` non protégée, redirect post-login → `/bibliographie` | ✅ |

---

## V1.9 — Module Lecture assistée + Analyse ✅ (terminé — Juin 2026)

**Objectif** : aider le chercheur à lire et contextualiser un article pertinent via upload PDF.

### Upload + chunking + embedding

| Fonctionnalité | État | Détail |
|---------------|------|--------|
| Upload PDF via UI (max 20 Mo) | ✅ | `POST /api/analyse/upload` |
| Parse PDF → texte par page (lib-pdf via parsePdfBuffer) | ✅ | |
| Extraction DOI automatique (regex sur texte complet) | ✅ | |
| Chunking EN (CHUNK_SIZE=600, CHUNK_OVERLAP=100) | ✅ | chunkText() réutilisé |
| Embedding EN 384D (Xenova all-MiniLM-L6-v2) | ✅ | embedQuery() |
| Stockage PDF dans Supabase Storage (bucket "analyses") | ✅ | |
| Chunks `is_temp=true` liés à l'analyse (`analysis_id`) | ✅ | |
| Table `document_analyses` (status machine + JSONB résultats) | ✅ | Migration 20260617 |

### Calcul des insights (`GET /api/analyse/[id]/insights`)

| Fonctionnalité | État | Détail |
|---------------|------|--------|
| Résumé structuré GPT (tldr / intro / méthodes / résultats / discussion) | ✅ | Contexte 14k chars max, JSON mode |
| Embedding moyen de l'article (all chunks → mean vector) | ✅ | Représentation fidèle sans biais position |
| Passages corpus les plus proches (match_chunks, threshold=0.1, top 6) | ✅ | |
| Extraction DOIs cités (regex section References) | ✅ | |
| Croisement cited_refs avec corpus (DOI matching → in_corpus) | ✅ | |
| Métadonnées SS pour références citées (batch API) | ✅ | titre, auteurs, année |
| paperId Semantic Scholar de l'article analysé | ✅ | via DOI |
| Recommandations SS (10 articles similaires) | ✅ | POST /recommendations/v1/papers/ |
| Cache : si status=completed → retour immédiat sans recalcul | ✅ | |
| Calcul en parallèle (Promise.allSettled) | ✅ | Résumé + corpus + SS en simultané |

### Interface page `/analyse/[id]`

| Fonctionnalité | État | Détail |
|---------------|------|--------|
| Onglet 1 — Proximité corpus | ✅ | ScoreRing + passages avec % et extrait |
| Onglet 2 — Résumé | ✅ | tldr en avant + 4 sections structurées |
| Onglet 3 — Discussion (chat) | ✅ | PDF gauche (3/5) + chat droite (2/5) |
| · PDF viewer horizontal scroll (toutes pages en ligne) | ✅ | react-pdf, height=480px, scroll sync |
| · Navigation PDF sur clic source | ✅ | pageRefs + scrollIntoView smooth |
| · Highlight texte sur page cible | ✅ | customTextRenderer (yellow mark) |
| · Modal PDF plein écran | ✅ | Dialog 96vw × 94vh |
| · Chat style ChatGPT (messages ancrés bas, overflow vers haut) | ✅ | Spacer flex-1 pattern |
| · Citations [N] cliquables dans les réponses | ✅ | renderInline() |
| · Markdown dans les réponses (bold, headers, listes) | ✅ | renderMarkdown() |
| · Suggestions initiales (4 questions pertinentes) | ✅ | Hardcodées, visibles si 0 messages |
| · Dropdown sources sous chaque réponse (document + corpus) | ✅ | Badge "p. X" amber, % similarité |
| · Scroll ChatGPT — conteneur hauteur fixe, `min-h-0` sur grid | ✅ | |
| Onglet 4 — Aller plus loin | ✅ | Références citées (✓ corpus / —) + recs SS |
| Bouton "Intégrer au corpus" | ✅ | `POST /api/analyse/[id]/integrate` → is_temp=false |
| Hauteur fixe (calc 100vh - 57px), scroll body bloqué en Discussion | ✅ | |

### API Analyse

| Route | Méthode | Usage |
|-------|---------|-------|
| `/api/analyse/upload` | POST | Upload PDF → parse → chunk → embed → document_analyses |
| `/api/analyse/[id]/insights` | GET | Résumé GPT + corpus_refs + cited_refs + ss_recs (avec cache) |
| `/api/analyse/[id]/chat` | POST | Discussion IA sur le document (streaming SSE) |
| `/api/analyse/[id]/pdf` | GET | URL signée Supabase Storage (1h) |
| `/api/analyse/[id]/integrate` | POST | is_temp=false → intégration corpus permanente |
| `/api/analyse/[id]/suggestions` | GET | 4 suggestions hardcodées |
| `/api/analyse/warmup` | GET | Warm-up Xenova avant la première question |

---

## État corpus (juin 2026)

| Élément | Valeur |
|---------|--------|
| Documents corpus | ~3 700 (2024-2026) |
| Articles auteur (`is_author_article=true`) | 521 |
| Total chunks | 848 857 |
| Dimension embeddings | 384D (all-MiniLM-L6-v2) |
| Index IVFFlat | `idx_chunks_embedding` (lists=100) — 1.3 Go, valid=t |
| DB Supabase | ~7 Go (plan Pro 25$/mois, limite 8 Go) |
| UMAP | Non recalculé sur ce corpus (à faire : `compute_umap.py`) |

---

## V2.0 — Double scoring auteur ✅ (terminé — Juin 2026)

Stratégie de scoring enrichie : les articles de veille sont maintenant scorés contre **deux référentiels** en parallèle.

| Fonctionnalité | État | Détail |
|---------------|------|--------|
| Colonne `author_score float` dans `veille_items` | ✅ | Migration 20260623100000 |
| Colonne `author_score float` dans `document_analyses` | ✅ | Migration 20260623120000 |
| RPC `match_author_chunks` (is_author_article=true) | ✅ | Migration 20260623110000, plpgsql volatile |
| Pipeline veille score.ts — double scoring en parallèle | ✅ | `match_chunks` + `match_author_chunks` simultanés |
| Script rétroactif `score-author.ts` | ✅ | `npx tsx scripts/veille/score-author.ts [--all] [--limit=N]` |
| UI Veille — badge orange "auteur XX%" sur les cards | ✅ | VeilleArticleCard + bibliographie/page.tsx |
| UI Analyse — badge "Score auteur" onglet Proximité | ✅ | Recalcul automatique sur analyses en cache |
| Page Database — carte UMAP "auteur vs corpus" | ✅ | AuthorVsCorpusMap (orange=auteur, gris=corpus) |
| `compute_umap.py` réécriture psycopg2 | ✅ | Bypass statement_timeout, flag `--all` |

### Seuils double scoring (juin 2026)
- `author_score` ≥ 75% = très proche des thématiques du chercheur
- `author_above_75` observé : 0/1204 (score auteur = critère plus exigeant que corpus)
- 22/1204 articles ont un `author_score` calculé (script rétroactif partiel)

---

## V2.1 — Améliorations prévues

| Fonctionnalité | Priorité | Détail |
|---------------|----------|--------|
| UMAP recalculé sur corpus actuel (848k chunks) | P1 | Relancer `compute_umap.py --all` (10-20 min) |
| Isolation Forest / One-Class SVM sur articles auteur | P1 | sklearn, labels implicites, intégration pipeline veille |
| Nettoyage automatique analyses expirées (expires_at) | P1 | Cron ou trigger Supabase |
| Upload depuis la page veille (article → analyse directe) | P1 | Lien "Analyser" sur VeilleArticleCard |
| Filtres page veille (auteur, journal, date, score) | P2 | |
| Notifications veille (email si articles > seuil) | P3 | |
| Clé API Semantic Scholar (`SS_API_KEY`) | P2 | Formulaire soumis — à ajouter dans secrets GitHub |
| Extension corpus 2015-2023 | P3 | ~13 000 PDFs — dépend de l'espace DB restant |
| Re-embedder articles auteur avec SPECTER2 (768D) | P3 | Conditionnel — si UMAP montre clusters bien séparés |
