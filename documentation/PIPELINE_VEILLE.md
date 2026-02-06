# Pipeline Veille — Alexandria

**Objectif** : document de référence pour le module Veille (scraping intelligent, garde-fous, similarité vs DB vectorielle).

---

## 1. Vue d’ensemble

- **Déclenchement** : bouton dans l’UI (pour l’instant). Run peut durer très longtemps → **job asynchrone** (queue).
- **Run** : **toutes les sources d’un coup** (une run = toutes les sources, pas une run par source).
- **Sources** : 100 % en base (Supabase) ; aucun fichier de config en dur.
- **À terme** : comparer les items récupérés avec la **DB vectorielle** pour une **analyse de similarité** (embedding abstract vs corpus → score → liste rankée).

---

## 2. Étapes de la pipeline

### 2.1 Récupération des pages sources

- Lire la **liste des sources** depuis Supabase (URLs des pages à scraper).
- **Fetch HTML** des pages sources (une par source).
- Pas de config fichier ; tout vient de la DB.

### 2.2 Nettoyage HTML → extraction d’URLs

- Nettoyer le code HTML pour extraire **uniquement les URLs**.
- Cibler en priorité les URLs susceptibles d’être des **pages d’article** (filtres heuristiques si besoin).
- Sortie : liste d’URLs candidates.

### 2.3 Garde-fous (avant LLM)

- **Dédup par DOI** : s’appuyer sur ce qu’on a en DB pour **couper le flux** qu’on envoie au LLM. Au trigger, les articles déjà présents (DOI en base) = déjà scrappés → ne pas les renvoyer au LLM.
- **Pré-filtrage des URLs** : bloquer avant le LLM (règles / heuristiques, éventuellement depuis la DB par source) pour **éviter coûts inutiles**. À affiner selon la qualité des réponses.
- **Rate limit, quotas** : limiter la charge de la pipeline (ex. max URLs par run, une run à la fois).

### 2.4 Filtrage des URLs par LLM

- Envoyer la liste d’URLs **déjà filtrée** (après guardrails) au LLM.
- Le LLM ne renvoie **que les URLs de pages d’articles**.
- Réduction du bruit et des coûts grâce au blocage en amont.

### 2.5 Extraction des données article (LLM)

- Pour chaque URL de page article : récupérer le HTML.
- **Pré-nettoyage** : isoler le **bloc article seul** (ex. trafilatura / readability) → ne pas envoyer tout le HTML au LLM.
- Envoyer **ce bloc seul** au LLM pour extraire : **titre, auteurs, DOI, abstract, date** (et autres champs si besoin).
- **Schéma de sortie fixe** pour toutes les sources (même structure JSON).

### 2.6 Erreurs et logs

- En cas d’échec (timeout, 403, LLM fail) : **skip + log**, continuer la pipeline.
- **Logs sur la ligne en DB** suffisent : champ `last_error` sur l’item ou sur la run ; pas de table `veille_errors` dédiée pour le POC.

### 2.7 Similarité vs DB vectorielle (à terme)

- **Embedding** des abstracts extraits.
- **Comparaison** avec la DB vectorielle (corpus / index abstracts).
- **Score de similarité** → écriture dans `veille_items` (ex. `similarity_score`).
- **Liste rankée** sur le front (pertinence scientifique personnalisée).

---

## 3. Flux résumé (ordre des étapes)

```
UI (bouton) → job asynchrone
  → 1. Lire sources (Supabase)
  → 2. Fetch HTML pages sources
  → 3. Nettoyer HTML → extraire URLs (candidates)
  → 4. Guardrails : dédup DOI vs DB, pré-filtre URLs, quotas
  → 5. LLM : filtrer URLs → ne garder que pages articles
  → 6. Pour chaque URL article :
        → fetch HTML page article
        → pré-nettoyage bloc article (trafilatura / readability)
        → LLM : extraire titre, auteurs, DOI, abstract, date (schéma fixe)
        → skip + log si erreur
  → 7. Embedding abstract → similarité vs DB vectorielle
  → 8. Écriture veille_items (last_error si échec)
  → Front : liste rankée avec URL
```

---

## 4. Structure de code (lib/veille)

| Fichier | Responsabilité |
|---------|----------------|
| **sources.ts** | Récupérer la liste des sources depuis Supabase. |
| **fetch-source-pages.ts** | Récupérer le HTML des pages sources (URLs en DB). |
| **extract-urls.ts** | Nettoyer HTML → extraire les URLs (candidates article). |
| **guardrails.ts** | Dédup DOI vs DB ; pré-filtre URLs avant LLM ; rate limit, quotas. |
| **filter-urls-llm.ts** | LLM : ne garder que les URLs de pages articles (après guardrails). |
| **extract-article-llm.ts** | Pré-nettoyage bloc article (trafilatura) → LLM : titre, auteurs, DOI, abstract, date (schéma fixe). |
| **score.ts** | Similarité abstract vs DB vectorielle (embedding vs corpus). |

---

## 5. Décisions validées (synthèse)

| Sujet | Décision |
|-------|----------|
| Déclenchement | UI (bouton manuel). Job asynchrone (run peut durer longtemps). |
| Run | Toutes les sources d’un coup. |
| Dédup | DOI suffit ; s’appuyer sur la DB pour couper le flux avant LLM. |
| Filtrage URLs | Bloquer avant le LLM (règles / heuristiques) pour éviter coûts. |
| Extraction article | Bloc article seul (trafilatura / readability) ; schéma de sortie fixe. |
| Erreurs | Skip + log ; logs sur la ligne en DB (last_error). |
| Similarité | À terme : comparaison avec DB vectorielle pour analyse de similarité. |

---

## 6. Références

- **STRUCTURE_ET_ARCHITECTURE.md** : structure des dossiers, modèle de données, flux globaux.
- **VUE_ENSEMBLE_PROJET.md** : besoin, utilisateurs, flows d’usage.
