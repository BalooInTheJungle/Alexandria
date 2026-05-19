# ROADMAP — Alexandria

Plan d'évolution V1 → V2 → V3.
Mettre à jour ce fichier à chaque jalon atteint.

---

## V1 — Socle RAG fonctionnel ✅ (terminé)

**Objectif** : interroger le corpus scientifique de façon fiable en FR et EN.

| Fonctionnalité | État | Détail |
|---------------|------|--------|
| Ingestion PDF (Python) | ✅ | Parse + chunk + embed EN (traduction FR supprimée) |
| Recherche hybride (FTS + vector + RRF) | ✅ | EN uniquement, paramètres dynamiques |
| Garde-fou hors domaine | ✅ | Seuil similarity_threshold depuis rag_settings |
| Génération réponse (streaming SSE) | ✅ | gpt-4o-mini, citations [1][2]... |
| Conversations + historique | ✅ | Pagination cursor, PATCH titre, DELETE |
| Paramètres RAG dynamiques | ✅ | rag_settings en base, GET + PATCH avec validation |
| Cron rétention 30 jours | ✅ | Nettoyage automatique conversations |
| Auth (login/logout) | ✅ | Supabase Auth |
| Pipeline veille (RSS + OpenAlex + scoring) | ✅ | 43 sources, filtre 7j, dédup DOI, similarity_score |

---

## V1.5 — Interface & Sources (en cours)

**Objectif** : rendre l'application utilisable au quotidien par le chercheur.

| Fonctionnalité | État | Détail |
|---------------|------|--------|
| Navigation header (Chatbot / Database / Bibliographie) | ✅ | Layout complet |
| Interface front RAG (sidebar, messages, scroll infini) | ✅ | Fonctionnelle |
| Page Bibliographie refonte (tabs, cards articles, slider seuil) | ✅ | Cards 2 colonnes, seuil 75%, filtre minScore |
| Progression pipeline live (4 phases + barre scoring) | ✅ | phases sources/urls/items/summary/done, progress toutes les 50 |
| Scoring double (similarity + heuristic) | ✅ | similarity seul affiché en Final, heuristic informatif |
| Résumé IA hebdomadaire | ✅ | GPT-4o-mini, contexte chunks corpus avec doc_title, stocké en DB |
| Page Sources dédiée `/bibliographie/sources` | ✅ | Gestion active/inactive, ajout source |
| Historique runs `/bibliographie/historique/[id]` | ✅ | Tableau complet avec scores |
| Streaming SSE + citations `[1][2]` | ⚠️ À vérifier | Messages en `<pre>` brut actuellement |
| Upload PDF via UI | ⏳ | Pipeline upload → ingestion |
| Page Database — KPIs + dataviz | ✅ | KPI cards, word cloud, bar chart termes, UMAP scatter, analytics RAG |
| Page Database — UMAP 2D corpus | ✅ | compute_umap.py → colonnes chunks.umap_x/umap_y → ScatterChart |
| Logs requêtes RAG (query_logs) | ✅ | Table query_logs, RPC stats daily, fire-and-forget dans /api/rag/chat |
| Analytics comportement RAG | ✅ | GET /api/analytics/overview, graphe daily queries |

---

## V1.6 — Ingestion corpus bulk ✅ (terminé — 2024-2025)

**Objectif** : ingérer le corpus récent (2024-2025) avec index pgvector opérationnel.

| Étape | État | Détail |
|-------|------|--------|
| Script Python `scripts/ingest.py` v3 | ✅ | Récursif, YEAR_MIN/MAX configurable, IVFFlat auto via psycopg2 |
| Suppression pipeline FR (embedding_fr, content_fr, detect-lang) | ✅ | Simplifié EN uniquement |
| Suppression index HNSW → passage IVFFlat | ✅ | IVFFlat lists=100, créé par ingest.py après tous les inserts |
| Ingestion 2024-2025 (2510 docs) | ✅ | 497 523 chunks, avg 198 chunks/doc |
| Index IVFFlat opérationnel | ✅ | `idx_chunks_embedding` IVFFlat lists=100 |
| Pipeline veille scoring fonctionnel | ✅ | 134 articles ≥ 30% sur corpus 2024-2025 |
| Sélecteur seuil veille (20→70%) | ✅ | Défaut 30%, modifiable depuis l'UI |
| Batch score updates veille (50 parallèle) | ✅ | Was séquentiel → bloquait pipeline 2-3min |
| Nettoyage titres espacés (`fix_spaced_text`) | ✅ | 2656 titres corrigés en DB + fix dans ingest.py |
| Réorganisation PDFs par année publication | ✅ | `reorganize_pdfs.py` → `data/pdfs2/YEAR/` |
| Ingestion incrémentale 2025 (pdfs2/) | 🔄 En cours | ~1172 PDFs, dédup DOI automatique |
| Ingestion 2026 (146 docs) | ✅ | Ajoutés au corpus |
| Recalcul UMAP sur nouveaux chunks | ⏳ À faire | Relancer compute_umap.py après ingestion |
| Extension corpus 2015-2023 | ⏳ Option | ~13 000 PDFs supplémentaires, dépend espace DB |

---

## V2 — Veille augmentée

**Objectif** : aller plus loin dans la personnalisation et l'exploitation de la veille.

| Fonctionnalité | Priorité | Détail |
|---------------|----------|--------|
| Filtres dans la liste veille | P1 | Par auteur, journal, date, score minimum |
| Marquer "à lire" / "lu" / "ignoré" | P1 | État par article, persisté en base |
| Ajouter un article veille au corpus RAG | P1 | Depuis la liste veille → upload → ingestion automatique |
| Notifications veille | P2 | Email ou push quand un run produit des articles > seuil |
| Gestion des sources depuis l'UI | P2 | Ajouter / désactiver une source sans SQL |
| Score personnalisé (auteurs/labos) | P2 | Pondération manuelle sur les critères auteur/labo |
| Export de la liste veille | P3 | CSV ou PDF de la sélection rankée |

---

## V3 — IA explicable et amélioration continue

**Objectif** : mesurer les performances et créer une boucle de feedback pour améliorer le RAG et le scoring.

| Fonctionnalité | Priorité | Détail |
|---------------|----------|--------|
| Feedback utilisateur sur les réponses RAG | P1 | 👍/👎 par réponse, stocké en base |
| Tableau de bord qualité RAG | P1 | Taux de garde-fou, similarités moyennes, questions fréquentes |
| Feedback sur le scoring veille | P1 | Marquer un article comme pertinent/non pertinent → améliore le score |
| Amélioration automatique rag_settings | P2 | Suggestions de paramètres basées sur l'historique des feedbacks |
| Comparaison d'articles dans le RAG | P2 | "Compare ces deux approches dans mon corpus" |
| Exploration libre du corpus | P2 | Clustering thématique, carte des auteurs/labos |
| Rapport hebdomadaire automatique | P3 | Résumé veille + highlights corpus via email |
| OCR amélioré | P3 | Meilleure extraction des figures et tables des PDFs |

---

## Questions ouvertes

- **Seuil de pertinence veille** : automatique ou manuel par journal/auteur ?
- **Boucle de feedback** : quel signal utiliser pour améliorer le scoring (clics, marques, téléchargements) ?
- **Corpus à terme** : migration vers Supabase Storage pour les ~100 Go de PDFs ?
- **Accès multi-utilisateurs** : partage du corpus avec des collègues du laboratoire ?

---

## Suivi

Mettre à jour l'état des fonctionnalités au fil du développement.
Référencer la session dans `context/SESSION_LOG.md` quand un jalon est atteint.
