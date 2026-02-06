# Pipeline veille — condensé

**Rôle** : référence unique du module **Veille** : étapes, garde-fous, décisions, structure de code. Condensé à partir de PIPELINE_VEILLE et STRUCTURE_ET_ARCHITECTURE §4.1.

---

## 1. Vue d’ensemble

- **Déclenchement** : **bouton dans l’UI** (manuel). Une run peut durer très longtemps → **job asynchrone** (queue) à prévoir.
- **Run** : **toutes les sources d’un coup** (une run = toutes les sources listées en base, pas une run par source).
- **Sources** : **100 % en base** (Supabase, table `sources`) ; aucun fichier de config en dur. Les URLs des pages à scraper sont lues depuis la DB.
- **Objectif** : récupérer les **nouveaux articles** (titre, abstract, DOI, etc.), les **dédupliquer**, les **scorer** vs le corpus (similarité) et afficher une **liste rankée** sur le front avec URL.

---

## 2. Étapes de la pipeline (ordre)

1. **Lire les sources** : récupérer la liste des URLs depuis Supabase (`sources`).
2. **Fetch HTML des pages sources** : une requête par source pour obtenir le HTML des pages (ex. listes d’articles).
3. **Nettoyage HTML → extraction d’URLs** : parser le HTML pour extraire **uniquement les URLs** ; cibler en priorité les URLs susceptibles d’être des **pages d’article** (filtres heuristiques si besoin). Sortie : liste d’URLs candidates.
4. **Garde-fous (avant LLM)** :  
   - **Dédup par DOI** : les articles déjà présents en base (DOI connu) sont considérés comme déjà traités → ne pas les renvoyer au LLM.  
   - **Pré-filtrage des URLs** : règles ou heuristiques (par source si besoin) pour **réduire le volume** envoyé au LLM et limiter les coûts.  
   - **Rate limit / quotas** : limiter le nombre d’URLs par run, une run à la fois, etc.
5. **Filtrage des URLs par LLM** : envoyer la liste d’URLs (déjà filtrée) au LLM ; le LLM ne renvoie **que les URLs de pages d’articles** (pas les menus, FAQ, etc.).
6. **Extraction des données article (LLM)** : pour chaque URL de page article :  
   - Récupérer le HTML de la page.  
   - **Pré-nettoyage** : isoler le **bloc article seul** (ex. trafilatura, readability) pour ne pas envoyer tout le HTML au LLM.  
   - Envoyer **ce bloc** au LLM pour extraire : **titre, auteurs, DOI, abstract, date** (schéma de sortie **fixe** pour toutes les sources).  
   - En cas d’échec (timeout, 403, erreur LLM) : **skip + log** dans `last_error`, continuer avec les autres URLs.
7. **Similarité vs DB vectorielle** (à terme) : embedding des abstracts extraits → comparaison avec le corpus (pgvector) → **score de similarité** → écriture dans `veille_items.similarity_score`.
8. **Écriture en base** : pour chaque article extrait, insertion ou mise à jour dans `veille_items` (run_id, source_id, url, title, authors, doi, abstract, published_at, similarity_score, last_error si échec).
9. **Front** : affichage d’une **liste rankée** (par score ou date) avec titre, abstract, URL, score ; l’utilisateur clique sur l’URL pour lire l’article sur la source.

---

## 3. Garde-fous (résumé)

| Garde-fou | Rôle |
|-----------|------|
| **Dédup DOI** | Éviter de retraiter les articles déjà en base ; couper le flux avant d’envoyer au LLM. |
| **Pré-filtrage URLs** | Réduire le volume d’URLs envoyées au LLM (règles, heuristiques par source). |
| **Rate limit / quotas** | Une run à la fois ; limiter le nombre d’URLs ou d’appels LLM par run. |
| **Skip + log** | En cas d’erreur sur un item : ne pas bloquer la run ; enregistrer l’erreur dans `last_error` (item ou run). |

---

## 4. Décisions validées

| Sujet | Décision |
|-------|----------|
| **Déclenchement** | UI (bouton manuel). Job asynchrone car la run peut durer longtemps. |
| **Run** | Toutes les sources d’un coup (une run = une exécution complète). |
| **Dédup** | **DOI suffit** ; s’appuyer sur la DB pour filtrer en amont. |
| **Filtrage URLs** | Bloquer **avant** le LLM (règles / heuristiques) pour maîtriser les coûts. |
| **Extraction article** | **Bloc article seul** (pré-nettoyage type trafilatura / readability) puis LLM ; **schéma de sortie fixe** (title, authors, doi, abstract, date). |
| **Erreurs** | Skip + log ; **logs sur la ligne en DB** (`last_error` sur item ou run) ; pas de table `veille_errors` dédiée en POC. |
| **Similarité** | À terme : embedding abstract vs DB vectorielle → score → priorisation de la liste. |

---

## 5. Structure de code (lib/veille)

| Fichier | Responsabilité |
|---------|----------------|
| **sources.ts** | Récupérer la liste des sources depuis Supabase. |
| **fetch-source-pages.ts** | Récupérer le HTML des pages sources (URLs en DB). |
| **extract-urls.ts** | Nettoyer HTML → extraire les URLs candidates (articles). |
| **guardrails.ts** | Dédup DOI vs DB ; pré-filtre URLs avant LLM ; rate limit, quotas. |
| **filter-urls-llm.ts** | LLM : ne garder que les URLs de pages articles (après guardrails). |
| **extract-article-llm.ts** | Pré-nettoyage bloc article → LLM : titre, auteurs, DOI, abstract, date (schéma fixe). |
| **score.ts** | Similarité abstract vs DB vectorielle (embedding vs corpus). |

---

## 6. Flux résumé (liste numérotée)

1. UI (bouton) → création d’une run (veille_runs) → job asynchrone.  
2. Lire les sources (Supabase, table `sources`).  
3. Fetch HTML des pages sources.  
4. Nettoyer HTML → extraire URLs candidates.  
5. Guardrails : dédup DOI vs DB, pré-filtre URLs, quotas.  
6. LLM : filtrer les URLs → ne garder que les pages articles.  
7. Pour chaque URL article : fetch HTML → pré-nettoyage bloc article → LLM extrait titre, auteurs, DOI, abstract, date ; skip + log si erreur.  
8. (À terme) Embedding abstract → similarité vs DB vectorielle → score.  
9. Écriture `veille_items` (last_error si échec).  
10. Front : affichage liste rankée avec URL.

---

## 7. Références

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Besoins, flows d’usage veille. |
| **Fonctionnalités Front** | Liste rankée, bouton de déclenchement, affichage. |
| **Schéma DB et données** | Tables `sources`, `veille_runs`, `veille_items`. |
