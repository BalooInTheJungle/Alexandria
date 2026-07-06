# Page Database — KPIs, cartographie, analytics

**Rôle** : référence de la page `/database`, absente des autres docs (`CARTE_CORPUS.md` ne couvre que la carte UMAP). Écrit le 06/07/2026 en lisant directement le code (`app/(dashboard)/database/page.tsx`, `app/api/corpus/*`, `app/api/documents/*`, `app/api/analytics/*`).

---

## 1. Sections de la page (dans l'ordre d'affichage)

| Section | Alimentée par | Détail |
|---|---|---|
| **Ajouter des documents** | `POST /api/documents/upload` | Upload direct au corpus permanent (`is_temp=false`), voir `BACK_RAG.md` §5.1 |
| **KPIs corpus** | `GET /api/documents/stats` → `getDocumentStats()` | `docs.{done,pending,error,total}`, `chunks.{total,withEmbedding}`, `topTerms` (30 termes filtrés d'une liste de bruit — figures, tableaux, mots vides FR/EN), `errorDocs` (100 derniers documents en erreur) |
| **Top journaux du corpus** | `GET /api/corpus/journals` → RPC `get_journal_counts(top_n=20)` | Comptage par nom de journal, top 20 |
| **Carte du corpus — clusters thématiques** | `GET /api/corpus/map` | Voir `CARTE_CORPUS.md` (détail complet : niveau d'agrégation réel, clustering k-means côté front, limites d'interactivité) |
| **Articles auteur dans l'espace vectoriel** | `GET /api/corpus/map` (même endpoint, filtré par `is_author` côté front) | Overlay gris (corpus) / orange (articles auteur) sur les mêmes coordonnées UMAP — pas un second calcul |
| **Couverture temporelle du corpus** | `GET /api/corpus/timeline` → RPC `get_timeline_by_year(year_min=2000, year_max=2030)` | Distribution du nombre de documents par année de publication |
| **Articles publiés du chercheur — liens avec le corpus** | `GET /api/corpus/author-articles` (liste paginée) + `GET /api/corpus/author-articles/[id]/similar` (accordéon, à la demande) | Voir §2 |

---

## 2. `/api/corpus/author-articles` et `/similar` — détail

- **Liste** (`GET /api/corpus/author-articles?page=&pageSize=&year=`) : documents `is_author_article=true`, `status='done'`, paginés (défaut 50/page, max 200), triés par date décroissante, filtrables par année.
- **Similaires** (`GET /api/corpus/author-articles/[id]/similar?limit=`) : pour un article auteur donné,
  1. charge **tous** les embeddings de ses chunks (pas juste `position=0`),
  2. calcule la **moyenne** de ces vecteurs (`averageEmbeddings()`) — choix documenté dans `docs/DECISIONS.md` D16 : `position=0` est souvent le header/page de garde d'un vieux PDF, non représentatif,
  3. appelle la RPC `match_corpus_docs(query_embedding, match_count, chunk_candidates=limit*8, match_threshold=0.3)` — sur-échantillonne les chunks (×8) puis déduplique par document pour retourner des **documents**, pas des chunks,
  4. retourne jusqu'à 30 documents corpus les plus proches, avec le meilleur extrait (`best_chunk`, tronqué à 300 caractères).
- Affiché en **accordéon** sur la page : chargement à la demande au clic sur un article auteur, résultats mis en cache côté front (pas de re-fetch si déjà chargé).

---

## 3. Routes construites mais jamais appelées par le front (orphelines)

Vérifié par recherche exhaustive (`grep` sur `app/` et `components/`) : ces routes existent, fonctionnent, ont des logs `console.log` soignés — mais **aucune page ni composant ne les appelle**.

### `GET /api/analytics/overview`
Appelle `getQueryAnalytics()` (`lib/db/query-logs.ts`) : nombre total de requêtes RAG, activité des 30 derniers jours (via RPC `get_query_stats_daily`), taux de garde-fou déclenché, répartition FR/EN, requêtes les plus fréquentes (normalisées, dédupliquées). C'est un tableau de bord analytics complet et fonctionnel — **jamais branché à l'UI**. Candidat naturel pour la section "Tableau de bord qualité pipeline" listée dans `docs/FUTURE_EVOLUTIONS.md`, mais le back existe déjà, contrairement à ce que suggère cette dernière.

### `GET /api/documents/count`
Retourne simplement `{ count }` (nombre total de `documents`, tous statuts confondus, via `countDocuments()`). Redondant avec les chiffres déjà présents dans `/api/documents/stats` (`docs.total`) — probablement une route antérieure devenue inutile après l'ajout de `/stats`.

### `GET /api/corpus/clerac`
Appelle l'API OpenAlex avec un **ORCID en dur** (`0000-0001-5429-7418`) pour récupérer la liste des publications du chercheur porteur du projet, avec son email en `User-Agent` (`rodolphe.clerac@crpp.cnrs.fr`). C'est la seule trace dans tout le code de l'**identité réelle** du chercheur — tous les autres documents restent génériques ("chercheur CNRS"). Route non appelée par le front ; probablement un script de vérification/debug ponctuel (comparer la liste OpenAlex du chercheur aux 521 articles auteur déjà ingérés) laissé en place.

---

## 4. Note technique — `/api/documents` (liste) sort du pattern habituel

`app/api/documents/route.ts` (liste des documents indexés, `GET`, limité à 200, tri `created_at desc`) instancie son **propre client Supabase** via `createServerClient` + `cookies()` directement dans le fichier, au lieu de réutiliser `lib/supabase/server.ts` comme le fait le reste du projet. Fonctionnellement équivalent, mais incohérent avec la convention du reste du code (`documentation/STRUCTURE_ET_ARCHITECTURE.md` §"Clients Supabase") — à harmoniser si l'occasion se présente.

---

## 5. Références

- `documentation/CARTE_CORPUS.md` — détail complet de la carte UMAP (niveau d'agrégation, clustering, limites)
- `documentation/BACK_RAG.md` §5 — les 3 chemins d'ingestion PDF
- `docs/DECISIONS.md` D16 — choix de l'embedding moyen pour la comparaison auteur/corpus
- `docs/FUTURE_EVOLUTIONS.md` — évolutions envisagées, dont certaines ont déjà un back fonctionnel (voir §3 ci-dessus)
