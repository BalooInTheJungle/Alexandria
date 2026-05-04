# Carte du corpus — spécification

**Référence unique** pour la fonctionnalité « Carte du corpus » : objectif, données, design, architecture technique. Document de base pour guider le développement.

---

## 1. Vue d'ensemble

La **Carte du corpus** est une visualisation 2D interactive des documents indexés. Elle permet aux **utilisateurs finaux** d'explorer leur corpus, de repérer des **clusters thématiques** et de mieux comprendre leurs documents accumulés au fil des années.

- **Emplacement** : page **Database** de l'app (section dédiée ou onglet).
- **Données** : projection 2D des embeddings des documents (agrégation par document).
- **Mise à jour** : recalcul à chaque ingestion de documents.

---

## 2. Objectifs et utilisateurs

| Élément | Détail |
|--------|--------|
| **Utilisateurs** | Utilisateurs finaux de l'app (chercheurs, étudiants, etc.) |
| **Objectif principal** | Explorer le corpus et repérer les clusters pour mieux comprendre l'accumulation de documents |
| **Contexte** | Corpus de PDFs scientifiques indexés (RAG, veille) ; embeddings 384D (all-MiniLM-L6-v2) |

---

## 3. Données à afficher

### 3.1 Niveau d'agrégation

- **Un point = un document** (pas un chunk).
- **Raison** : lisibilité et pertinence pour l'utilisateur (il pense en « documents », pas en « passages »).
- **Calcul** : vecteur représentatif du document = moyenne des embeddings de ses chunks (ou centroid). Si un document n'a qu'un chunk, ce chunk = le point.

### 3.2 Corpus

- **Périmètre** : tous les documents en base (`documents` avec `status = 'done'`).
- **Filtrage** : à prévoir en v2 (par date, journal, etc.) si besoin.

### 3.3 Métadonnées affichées

| Contexte | Données |
|----------|---------|
| **Au survol (tooltip)** | Titre du document, DOI |
| **Couleur des points** | Par document (chaque document = une couleur distincte pour le différencier) |
| **Labels** | Titre du document, DOI (affichés au survol ; pas de labels permanents sur la carte pour éviter le bruit) |

---

## 4. Interactivité

| Fonctionnalité | Spécification |
|----------------|---------------|
| **Clic sur un point** | Afficher le document (modal ou redirection vers une vue détail / PDF) |
| **Zoom / pan** | Oui — navigation libre dans la carte |
| **Survol** | Tooltip avec titre + DOI |
| **Filtres** | Non en v1 ; à envisager en v2 (par date, journal, etc.) |
| **Recherche** | Non en v1 ; à envisager en v2 (afficher la requête + voisins sur la carte) |

---

## 5. Design

| Élément | Choix |
|---------|------|
| **Couleurs** | Par document (une couleur par point) |
| **Labels** | Titre document + DOI au survol uniquement |
| **Style** | Scatter plot 2D, points cliquables, tooltip au survol |

---

## 6. Architecture technique (proposition)

### 6.1 Réduction de dimension

- **Algorithme** : **UMAP** (recommandé pour la préservation des voisinages et la lisibilité des clusters).
- **Alternative** : t-SNE si UMAP pose des problèmes (plus lent, résultats parfois moins stables).
- **Entrée** : vecteurs 384D (moyenne des embeddings des chunks par document).
- **Sortie** : coordonnées (x, y) par document.

### 6.2 Stockage des coordonnées

- **Table** : `corpus_map_points` (ou colonnes ajoutées à `documents`).
- **Colonnes** : `document_id`, `x`, `y`, `updated_at`.
- **Mise à jour** : recalcul à chaque ingestion (ou via job dédié déclenché après ingestion).

### 6.3 Flux proposé

```
Ingestion document terminée
         │
         ▼  Trigger ou appel explicite : recalcul carte
         │
         ▼  1. Récupérer tous les documents (status = done) avec leurs chunks
         │  2. Pour chaque document : centroid = moyenne(embeddings des chunks)
         │  3. UMAP sur la matrice [documents × 384] → [documents × 2]
         │  4. Écrire (document_id, x, y) dans corpus_map_points
         │
         ▼  Front : GET /api/corpus-map → { points: [{ document_id, x, y, title, doi }] }
         │
         ▼  Scatter plot (Recharts ou Plotly) avec zoom/pan, tooltip, clic
```

### 6.4 Où exécuter la réduction

| Option | Avantages | Inconvénients |
|--------|-----------|---------------|
| **Script Python** (ingest ou dédié) | UMAP/t-SNE natifs, rapide | Nécessite Python dans le pipeline |
| **API Next.js + lib JS** (tsne-js, umap-js) | Tout en JS | UMAP/t-SNE en JS moins matures, peut être lent |
| **API Next.js + subprocess Python** | Flexibilité | Complexité déploiement |

**Recommandation** : **script Python** appelé après ingestion (comme `ingest.py`), ou **job/cron** si ingestion asynchrone. Le script écrit les coordonnées en base ; le front ne fait que les afficher.

### 6.5 Visualisation front

- **Librairie** : **Recharts** (déjà dans le stack) pour un scatter simple, ou **Plotly.js** si besoin de zoom/pan avancé.
- **Données** : API `GET /api/corpus-map` retourne `{ points: [{ document_id, x, y, title, doi }] }`.

---

## 7. Structure des fichiers (à créer)

| Fichier | Rôle |
|---------|------|
| `scripts/corpus_map.py` | Script : lit chunks, calcule centroids, UMAP, écrit `corpus_map_points` |
| `supabase/migrations/XXXXXX_corpus_map_points.sql` | Table `corpus_map_points` (document_id, x, y, updated_at) |
| `app/api/corpus-map/route.ts` | GET : retourne les points pour le front |
| `app/(dashboard)/database/page.tsx` | Intégration : section ou onglet « Carte du corpus » avec scatter |
| `components/corpus-map-scatter.tsx` | Composant scatter réutilisable |

---

## 8. Contraintes et choix

| Contrainte | Choix |
|------------|-------|
| **Volume** | Gérer jusqu'à ~1000–2000 documents (UMAP/t-SNE raisonnable). Au-delà, envisager sous-échantillonnage ou indexation incrémentale. |
| **Embedding** | Utiliser `embedding` (EN) ou `embedding_fr` selon préférence ; cohérent avec le reste de l'app. |
| **Documents sans chunks** | Exclure (ou point à part si besoin). |
| **Mise à jour** | Déclencher le recalcul à la fin de l'ingestion (dans le flow upload ou après le script ingest). |

---

## 9. Ordre de développement suggéré

1. **Migration** : table `corpus_map_points`.
2. **Script Python** : `corpus_map.py` (centroids + UMAP + écriture).
3. **API** : `GET /api/corpus-map`.
4. **Front** : composant scatter + intégration page Database.
5. **Intégration** : déclencher le script après ingestion (ou bouton « Recalculer la carte » en v1).

---

## 10. Références

- **UMAP** : [umap-learn](https://github.com/lmcinnes/umap) (Python)
- **Recharts Scatter** : [Recharts ScatterChart](https://recharts.org/en-US/api/ScatterChart)
- **Plotly** : [Plotly.js Scatter](https://plotly.com/javascript/line-and-scatter/) (zoom/pan natif)
- **Schéma DB** : `documentation/SCHEMA_DB_ET_DONNEES.md`
- **Tables sources** : `documents`, `chunks` (embedding, embedding_fr)
