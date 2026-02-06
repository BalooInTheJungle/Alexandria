# Référence stack — Alexandria

**Objectif** : synthèse des briques techniques (Local First / Cloud First) et tableaux d’outils pour le mémoire et l’implémentation.  
**Contexte** : POC puis production, **tout sur cloud** (Supabase, Next.js) ; pas de passage on-prem.

---

## 1. Flow technique cible (POC cloud)

1. **Veille (hebdo)** : scraper ~50 sources (HTML) → extraire métadonnées + abstract → dédup (DOI/titre).  
2. **Prétraitement** : normalisation texte + enrichissement (auteurs, journal, date, mots-clés).  
3. **Indexation** : FTS (Postgres) sur title/abstract/keywords ; embeddings (pgvector) sur abstract (et éventuellement title+abstract).  
4. **Recherche & ranking** : filtre bibliographique → FTS rank + vector rank → **RRF** → rerank optionnel (cross-encoder) sur topK.  
5. **Décision** : score final → « pertinent / à lire / ignorer » + explications + liens.  
6. **Évaluation & itération** : Precision@K, Recall@K, NDCG, temps, coût → ajustements.

---

## 2. Stack Local First (vue d’ensemble)

- **Scraping** : Playwright + BS4/lxml + rapidfuzz + RSS si possible + fallback IA local.  
- **Parsing PDF** : PyMuPDF (+ OCR fallback si besoin).  
- **DB** : Postgres + pgvector + Storage (cloud Supabase).  
- **Retrieval** : Postgres FTS + pgvector + RRF + reranker léger optionnel.  
- **Éval** : MLflow + notebook + métriques IR (Precision@K, Recall@K, NDCG).  
- **Itération** : petit dataset annoté + active learning.

---

## 3. Stack Cloud First (POC)

- **Veille** : HTML scraping (Playwright ou équivalent) ; sources depuis Supabase.  
- **Ingestion PDF** : GROBID ou PyMuPDF + OCR fallback ; chunking scientifique ; embeddings → FTS + pgvector.  
- **Serving RAG** : requête → filtre metadata → FTS + vector → RRF → rerank → génération sourcée + liens PDF (Storage).  
- **Hébergement** : Supabase (Postgres, pgvector, Storage, Auth) ; Next.js (Vercel ou autre).

---

## 4. Tableaux d’outils (synthèse)

### 4.1 Scraping / collecte (sans API officielle)

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **Playwright** | Robuste sur sites modernes (JS), login, pagination | 10 | Selenium, Puppeteer |
| **BeautifulSoup4 + lxml** | Parsing HTML, extraction champs | 8 | selectolax, parsel |
| **trafilatura / readability-lxml** | Nettoyer pages « article » | 7 | boilerpy3 |
| **Heuristiques + IA (LLM local)** | Extraction titre/auteurs/abstract/DOI si HTML variable | 8 | Règles XPath par source |
| **RSS/Atom** (si dispo) | Réduire scraping | 9 | — |
| **Dedup DOI + fuzzy title (rapidfuzz)** | Éviter doublons | 9 | Levenshtein |

**Recommandation** : Playwright pour le fetch ; règles CSS/selectors en priorité ; fallback IA sur pages non reconnues.

---

### 4.2 Parsing PDF & extraction

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **PyMuPDF (fitz)** | Texte + positions + pages (citations) | 10 | pdfplumber, pypdf |
| **GROBID** | Structure scientifique (titre, auteurs, sections) | 8 | CERMINE |
| **Unstructured** | Pipeline prêt à l’emploi (layout, tables) | 6 | Custom PyMuPDF |
| **OCR fallback (Tesseract)** | PDFs scannés | 7 | PaddleOCR, OCRmyPDF |

**Recommandation POC** : PyMuPDF d’abord ; GROBID si besoin d’une biblio très structurée (service à maintenir).

---

### 4.3 Représentation & indexation (FTS + vecteurs)

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **Postgres FTS (tsvector + GIN)** | Recherche lexicale (DOI, auteurs, termes) | 10 | Meilisearch, Typesense |
| **pgvector** | Stockage embeddings + index ANN ; portable | 10 | Qdrant, Milvus |
| **Embeddings local (sentence-transformers)** | Qualité + contrôle ; pas de coût API | 9 | API embeddings |
| **Chunking (sections)** | Meilleure granularité RAG | 9 | Chunking fixed-size |
| **Metadata schema (DOI, journal, date)** | Filtrage + ranking | 10 | — |

---

### 4.4 Retrieval & scoring (FTS + vector + RRF + rerank)

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **RRF** | Fusion FTS + vector sans calibrage complexe | 10 | Somme pondérée |
| **Cross-encoder reranker** | Gain précision sur topK | 8 | LLM rerank |
| **Règles métier (boost auteurs/journaux)** | Décision explicable | 10 | Modèle ML |

**Recommandation** : candidats = top 100 RRF(FTS, vector) ; rerank top 50 ; score final = rerank + boosts metadata.

---

### 4.5 Décision « pertinent / à lire / ignorer »

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **Heuristiques de seuils** | POC rapide, contrôlable | 9 | Classif supervisée |
| **scikit-learn (logreg, SVM, RF)** | Si dataset labelisé (100–500) | 7 | Fine-tuning |
| **TF-IDF** | Baseline + explicabilité | 7 | BM25 |

La classification peut venir **après** stabilisation du ranking.

---

### 4.6 Visualisation & monitoring

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **MLflow** | Tracking expériences (params, métriques) | 9 | W&B |
| **Metabase** | BI sur Postgres (KPI runs, volumes) | 8 | Supabase Studio |
| **Jupyter + seaborn/plotly** | Analyse offline | 8 | — |
| **Tables runs / logs / scores** | Audit et amélioration continue | 10 | Logs texte |

---

### 4.7 Itération / MLOps light

| Outil | Utilité | Score | Alternative |
|-------|---------|-------|-------------|
| **Jobs planifiés (cron)** | Runs hebdo + batch embeddings | 9 | GitHub Actions cron |
| **Dataset « gold » (labels)** | Vérité terrain pour Precision@K, Recall@K | 10 | Feedback implicite |
| **Error analysis (par facettes)** | Comprendre échecs (auteurs, journaux) | 10 | — |
| **A/B configs (RRF k, topK)** | Stabiliser config POC | 9 | — |

---

## 5. Dépendances « mères » (éviter doublons)

- **spaCy** : tokenisation, lemmatisation, NER (peut remplacer NLTK basique).  
- **scikit-learn** : TF-IDF, classifs, métriques, GridSearch.  
- **sentence-transformers** (Transformers + torch) : embeddings modernes.  
- **Playwright** : scraping « difficile » (JS, navigation).

---

## 6. Stack minimale recommandée (POC + production cloud)

| Brique | Choix |
|--------|-------|
| **Scraping** | Playwright + BS4/lxml + rapidfuzz + RSS si possible + fallback IA local |
| **Parsing PDF** | PyMuPDF (+ OCR fallback) |
| **DB** | Supabase Postgres + pgvector + Storage |
| **Retrieval** | Postgres FTS + pgvector + RRF + reranker optionnel |
| **Éval** | MLflow ou équivalent + notebook + métriques IR |
| **Itération** | Dataset annoté + active learning |

---

## 7. Références

- **VUE_ENSEMBLE_PROJET.md** : besoin, utilisateurs, flows d’usage.  
- **STRUCTURE_ET_ARCHITECTURE.md** : architecture technique, modèle de données, dossiers.
