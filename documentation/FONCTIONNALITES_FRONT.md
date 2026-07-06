# Fonctionnalités Front — Bibliographie, Analyse, Database

**Rôle** : référence des **fonctionnalités côté interface**, avec les subtilités : recherche, garde-fou, citations, streaming (module Analyse) ; affichage veille (module Bibliographie).

> Réécrit le 06/07/2026. Changements majeurs par rapport à l'ancienne version :
> - Il n'y a **plus de page RAG autonome** (`/rag`, `/rag/settings`) — retirée du dashboard en juin 2026. Le chat RAG existe toujours mais **dans l'onglet Discussion du module Analyse**.
> - **Plus de bilingue FR/EN** côté UI — pas de détection de langue, pas de sélecteur (voir `BACK_RAG.md`).
> - La page Bibliographie n'a plus de bouton "Lancer la recherche" avec chronomètre : la veille tourne **automatiquement chaque jour via GitHub Actions**, le front est **100% lecture**.
> - La gestion des Documents n'est plus une sous-page de Bibliographie : elle a été **fusionnée dans la page Database** (`app/(dashboard)/bibliographie/documents/page.tsx` redirige vers `/database`).

---

## 1. Vue d'ensemble

- **Périmètre** : utilisateur unique (chercheur), pas de multi-tenant. Login obligatoire (Supabase Auth).
- **3 zones dans le dashboard** : **Bibliographie** (veille + historique + sources), **Analyse** (upload PDF + 4 onglets), **Database** (KPIs corpus, UMAP, comparaison auteur).
- La route `/veille` existe encore mais **redirige** vers `/bibliographie` (compat liens existants).

---

## 2. Bibliographie (`/bibliographie`) — 3 onglets

### 2.1 Onglet "Veille" (défaut)

- **KPIs globaux** (6 cards) : Articles extraits, Articles scorés, "En lien" (≥75%), Articles lus, ✓ Pertinents, ✗ Non pertinents — alimentés par `GET /api/veille/stats`.
- **Filtres** : recherche par titre (client-side), filtre lu/non lu (Tous / Non lus / Lus), filtre pertinence (Tous / ✓ Pertinents / ✗ Non pertinents).
- **Liste paginée** (`GET /api/veille/items/top?page=N&relevant=...`) : cards article avec
  - badge score double : "Corpus" (`similarity_score`) + "Auteur" (`author_score`, si disponible, badge orange),
  - auteurs repliables (3 premiers + "+N auteurs"),
  - DOI cliquable, badge "Dans le corpus" si `document_id` renseigné,
  - bouton "Marquer comme lu" (`PATCH /api/veille/items/[id]` `{ read: bool }`),
  - **select pertinence à 3 états** (`PATCH /api/veille/items/[id]` `{ relevant: true|false|null }`) : "Indiquer la pertinence" / "✓ Pertinent" / "✗ Non pertinent",
  - bloc "Analyse IA" repliable (`ai_analysis.contribution/relevance/corpus_link`), affiché seulement si présent (donc pas pour tous les articles ≥75%, voir `PIPELINE_VEILLE_CONSOLIDE.md` §2 — cap à 8/jour),
  - références corpus repliables (`corpus_refs`, passages ≥75% avec extrait et page).
- **Pas de bouton de déclenchement manuel** dans cet onglet — la veille est 100% automatique (cron GitHub Actions quotidien).

### 2.2 Onglet "Historique"

- Tableau des runs (`GET /api/veille/runs?limit=20`) : date/heure, statut (Terminé/En cours/Échec, badge coloré), nb extraits, nb pertinents ≥75%, nb analyses IA.
- Clic sur une ligne → `/bibliographie/historique/[runId]` (détail du run : logs pipeline, thèmes, synthèse, liste complète des articles du run).
- Le composant conserve un mapping de labels pour **les deux générations de pipeline** (`PHASE_LABELS` distingue phases legacy `sources/urls/items/summary` et phases actuelles `filter/openalex/crossref/insert/extracted/scoring/scored/recap_articles/recap_articles_done/recap_global/done`) — utile si d'anciens runs legacy restent affichés dans l'historique.

### 2.3 Onglet "Sources"

- CRUD des sources de veille : liste groupée par éditeur, filtre par éditeur, filtre "actives seulement", toggle actif/inactif par source (`PATCH /api/veille/sources/[id]`), formulaire d'ajout (`POST /api/veille/sources` : nom, éditeur, ISSN, URL, URL RSS optionnelle → sinon fallback OpenAlex).

---

## 3. Analyse (`/analyse`) — upload + 4 onglets

### 3.1 Page liste (`/analyse`)

- **Zone d'upload** : glisser-déposer ou clic, PDF uniquement, max 20 Mo. Un appel `GET /api/analyse/warmup` est déclenché en parallèle de l'upload pour préchauffer le modèle d'embedding Xenova (réduit la latence perçue).
- **Liste "Articles pertinents à analyser"** : reprend les articles renvoyés par `GET /api/veille/items/top?page=1` (donc en réalité tous les articles **≥75%**), avec un bouton "Analyser le PDF" par article qui envoie directement le fichier local à `/api/analyse/upload`.
  > ⚠️ **Le libellé affiché est trompeur** : le titre de section dit *"score ≥ 80%"*, mais la route appelée (`/api/veille/items/top`) filtre en réalité à **≥75%** (`MIN_SCORE=0.75` dans `app/api/veille/items/top/route.ts`) et le composant n'applique aucun filtre supplémentaire côté client. À corriger dans le code ou, a minima, à ne pas citer "80%" comme seuil réel de cette liste dans le mémoire.

### 3.2 Page détail (`/analyse/[id]`) — 4 onglets

| Onglet (id interne) | Nom affiché | Contenu |
|---|---|---|
| `corpus` | Proximité corpus | `corpus_refs` (passages similaires), `author_score` |
| `summary` | Résumé | Résumé structuré GPT (`{ intro, methods, results, discussion, tldr }`) |
| `chat` | Discussion | Chat streaming SSE — **c'est ici que vit l'ancien chatbot RAG**, réutilisant `lib/rag/search.ts` + `lib/rag/openai.ts` |
| `recommend` | Aller plus loin | Références citées (`cited_refs`, avec statut "dans le corpus" ou non) + recommandations Semantic Scholar (`ss_recs`) |

- Bouton "Intégrer au corpus" → `POST /api/analyse/[id]/integrate` (`is_temp=false`).
- PDF affiché avec scroll synchronisé aux citations (`components/analyse/AnalysisPdfViewer.tsx`).

---

## 4. Ce qui reste du chat RAG (dans Analyse, pas en page dédiée)

Les comportements ci-dessous, décrits auparavant pour une page `/rag` indépendante, s'appliquent maintenant à l'onglet **Discussion** du module Analyse :

- **Streaming** : `stream: true` par défaut, affichage progressif via SSE.
- **Citations** `[1]`, `[2]`… dans le texte, avec sources (titre, DOI, extrait) — toujours en anglais (pas de traduction FR des extraits, voir `BACK_RAG.md` §4).
- **Garde-fou** : message fixe si la requête est hors domaine (voir `BACK_RAG.md` §2.1/§2.3 pour le détail, y compris le mode "connaissances générales" non documenté auparavant).
- **Pas de panneau admin front pour `rag_settings`** actuellement identifié dans le dashboard — les routes `GET`/`PATCH /api/rag/settings` existent côté back mais aucune page du dashboard actuel ne les appelle (à vérifier avant de citer un "panneau admin" dans le mémoire).

---

## 5. Documents et corpus — page Database (`/database`)

- **Emplacement** : la gestion des documents (upload direct au corpus) est sur la page **Database**, pas Bibliographie. `app/(dashboard)/bibliographie/documents/page.tsx` n'est qu'une redirection vers `/database`, conservée pour compatibilité de lien.
- Contenu de la page Database (aperçu, voir `CARTE_CORPUS.md` pour le détail UMAP) : carte "Ajouter des documents" (upload direct `POST /api/documents/upload`), KPIs top journaux, carte du corpus (clusters UMAP), position des articles auteur dans l'espace vectoriel, couverture temporelle, liste des articles auteur avec liens corpus.

---

## 6. Synthèse état actuel (remplace l'ancien tableau Fait/À faire, largement caduc)

| Fonctionnalité | État |
|---|---|
| Auth (login Supabase) | ✅ |
| Page RAG autonome + sidebar conversations | ❌ retirée — chat déplacé dans Analyse |
| Détection de langue / bilingue UI | ❌ abandonné |
| Bibliographie — liste veille ≥75%, paginée, filtres lu/pertinence | ✅ |
| Bibliographie — déclenchement manuel | ❌ plus nécessaire (automatique GitHub Actions) |
| Bibliographie — gestion des sources (CRUD) | ✅ onglet Sources |
| Analyse — upload + 4 onglets | ✅ |
| Analyse — intégration corpus | ✅ |
| Documents — upload direct corpus | ✅ déplacé sur `/database` |
| Panneau admin `rag_settings` | ⚠️ routes back existantes, pas de page front confirmée |

---

## 7. Références

| Document | Contenu |
|----------|---------|
| `BACK_RAG.md` | API chat, recherche, garde-fou, paramètres (détail back) |
| `PIPELINE_VEILLE_CONSOLIDE.md` | Pipeline veille complet, seuils, cap 8/jour |
| `SCHEMA_DB_ET_DONNEES.md` | Tables, migrations |
| `CARTE_CORPUS.md` | Détail page Database / UMAP |
