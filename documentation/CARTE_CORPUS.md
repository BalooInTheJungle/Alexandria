# Carte du corpus — implémentation réelle

**Rôle** : référence de la fonctionnalité « Carte du corpus » — ce qui est effectivement construit, page Database.

> Réécrit le 06/07/2026. L'ancienne version était une **spécification pré-développement** ("structure des fichiers à créer", "ordre de développement suggéré"). La fonctionnalité est **implémentée depuis**, mais différemment de la spec sur plusieurs points importants : stockage des coordonnées, niveau d'agrégation, clustering, interactivité. Le detail ci-dessous reflète le code réel (`scripts/compute_umap.py`, `app/api/corpus/map/route.ts`, `app/(dashboard)/database/page.tsx`).

---

## 1. Vue d'ensemble

- **Emplacement** : page `/database`, deux visualisations distinctes (pas une seule carte) :
  1. **"Carte du corpus — clusters thématiques"** : scatter coloré par cluster k-means.
  2. **"Articles auteur dans l'espace vectoriel"** : même nuage de points, coloré par corpus (gris) vs articles auteur (orange).
- **Calcul UMAP** : offline, script Python (`scripts/compute_umap.py`), **pas de recalcul automatique après ingestion** — à relancer manuellement (`cd scripts && python3 compute_umap.py`).

---

## 2. Niveau d'agrégation réel (différent de la spec)

La spec prévoyait "un point = un document" via un **centroïde** (moyenne des embeddings de tous les chunks du document). **Ce n'est pas ce qui est implémenté** :

- **Mode par défaut** (`python3 compute_umap.py`) : prend le chunk à **`position = 0`** de chaque document (le premier chunk, typiquement l'abstract/l'intro) comme représentant du document — **pas une moyenne**. Environ 3 700 points (1 par document).
- **Mode `--all`** (`python3 compute_umap.py --all`) : UMAP sur **tous les chunks** (848k), niveau chunk et non document — beaucoup plus lourd, mentionné dans le script mais pas confirmé comme utilisé en routine.
- Les deux modes excluent les chunks `is_temp=true` (analyses non intégrées).

> Pour le mémoire : dire "la carte représente un centroïde par document" serait inexact. Le point représentatif par défaut est le **premier chunk**, pas une moyenne.

---

## 3. Stockage des coordonnées

- **Pas de table dédiée** `corpus_map_points` comme prévu par la spec.
- Les coordonnées sont écrites directement sur `chunks.umap_x` / `chunks.umap_y` (migration `20260505140000_chunks_umap.sql`), avec un index partiel `WHERE umap_x IS NOT NULL`.
- Conséquence : la "carte" est en réalité une projection de **chunks** (dont un sous-ensemble représente les documents en mode par défaut), pas d'une table de documents dédiée.

---

## 4. API réelle

- **Route** : `GET /api/corpus/map` (et non `GET /api/corpus-map` comme prévu par la spec).
- **Implémentation** : lit `chunks` (jointure `documents`), filtre `umap_x`/`umap_y` non nuls, limite à **5000 points** (`SAMPLE_SIZE`).
- **Réponse** : `{ points: [{ id, x, y, doc_id, doc_title, year, is_author }], computed: boolean }` — `is_author` vient de `documents.is_author_article`, utilisé pour la seconde visualisation (auteur vs corpus).
- Pas de DOI renvoyé par cette route (contrairement à la spec qui prévoyait DOI au survol).

---

## 5. Clustering — calculé côté front, pas en base

- **Aucun clustering n'est stocké en base.** Le composant `CorpusMap` (`app/(dashboard)/database/page.tsx`) applique un **k-means en JavaScript** (`kmeansCluster`) directement sur les coordonnées `(x, y)` reçues de l'API, à chaque rendu.
- **Nombre de clusters** : fixe, `K_CLUSTERS = 8` dans le composant — pas adaptatif au volume de documents.
- **Label de cluster** : dérivé heuristiquement des mots les plus fréquents dans les titres des documents du cluster (`clusterLabel()`), pas par LLM ni par `get_corpus_top_terms`.
- **Fraîcheur** : chaque cluster affiche une pastille de fraîcheur basée sur l'année médiane des documents du cluster (`medianYear`, `freshnessInfo`).

---

## 6. Interactivité réelle (moins riche que la spec)

| Fonctionnalité prévue (spec) | Réalité |
|---|---|
| Clic sur un point → afficher le document | ❌ **Non implémenté** — aucun `onClick` sur les points `Scatter` |
| Zoom / pan libre | ❌ **Non implémenté** — axes cachés (`hide`), pas de zoom Recharts configuré |
| Survol → tooltip titre + DOI | ⚠️ Partiel — tooltip affiche **titre + année**, **pas de DOI** (l'API ne le renvoie pas) |
| Couleur par document | ❌ Couleur par **cluster** (plusieurs documents partagent une couleur), pas par document individuel |
| Filtres (date, journal) | ❌ Non implémenté |
| Recherche (requête + voisins) | ❌ Non implémenté |

La seconde visualisation ("Articles auteur vs Corpus") a le même niveau d'interactivité (tooltip titre+année uniquement), sans clustering — juste une distinction de couleur binaire (gris = corpus, orange = auteur).

---

## 7. Fichiers réels (remplace la section "à créer" de la spec)

| Fichier | Rôle |
|---------|------|
| `scripts/compute_umap.py` | Lit les embeddings (1/doc ou tous), calcule UMAP (`umap-learn`), écrit `chunks.umap_x`/`umap_y` via `psycopg2` |
| `supabase/migrations/20260505140000_chunks_umap.sql` | Colonnes `umap_x`, `umap_y` sur `chunks` (pas de table séparée) |
| `app/api/corpus/map/route.ts` | `GET` — retourne jusqu'à 5000 points (chunks + métadonnées document) |
| `app/(dashboard)/database/page.tsx` | Contient `CorpusMap` (clusters k-means) et `AuthorVsCorpusMap` (comparaison) |
| `recharts` (`ScatterChart`, `Scatter`) | Librairie de rendu — conforme à la recommandation d'origine |

---

## 8. Contraintes réelles

- **Volume** : 5000 points max renvoyés par l'API (`SAMPLE_SIZE`), pas de sous-échantillonnage adaptatif documenté au-delà.
- **Documents sans chunk `position=0`** (ou dont ce chunk n'a pas d'embedding) : absents de la carte en mode par défaut.
- **Mise à jour** : entièrement manuelle — pas de trigger, pas de job automatique après ingestion. Le `CLAUDE.md` liste d'ailleurs "UMAP recalculé sur corpus actuel — ⏳ à relancer" comme tâche en attente à la date de rédaction.

---

## 9. Références

- `documentation/SCHEMA_DB_ET_DONNEES.md` — colonnes `chunks.umap_x`/`umap_y`
- `documentation/STRUCTURE_ET_ARCHITECTURE.md` — page Database dans l'arborescence
- `CLAUDE.md` — commande `compute_umap.py`, état d'avancement
