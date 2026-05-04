# Pipeline veille — condensé

**Rôle** : référence unique du module **Veille** : étapes, garde-fous, décisions, structure de code. Condensé à partir de PIPELINE_VEILLE et STRUCTURE_ET_ARCHITECTURE §4.1.

---

## 1. Vue d’ensemble

- **Déclenchement** : **bouton dans l’UI** (manuel). Une run peut durer très longtemps → **job asynchrone** (queue) à prévoir.
- **Run** : **toutes les sources d’un coup** (une run = toutes les sources listées en base, pas une run par source).
- **Sources** : **100 % en base** (Supabase, table `sources`) ; aucun fichier de config en dur. Les URLs des pages à scraper sont lues depuis la DB.
- **Objectif** : récupérer les **nouveaux articles** (titre, abstract, DOI, etc.), les **dédupliquer**, les **scorer** vs le corpus (similarité) et afficher une **liste rankée** sur le front avec URL.

---

## 2. Étapes de la pipeline (ordre — implémentation actuelle)

1. **Lire les sources actives** : `getRssSources()` + `getOpenAlexSources()` depuis Supabase (filtre `active=true`).
2. **Fetch RSS en parallèle** : 5 sources simultanées → ~16s pour 43 sources. Extraction : titre, DOI, abstract, auteurs, date.
3. **Filtre éditorial** : skip corrections, errata, rétractations (regex sur le titre).
4. **Filtre date** : articles > 7 jours → skip.
5. **Dédup DOI** : comparaison avec `getKnownDois()` (tous les DOIs déjà en base).
6. **Enrichissement OpenAlex** (batch cross-sources) :
   - DOIs sans abstract → batch `/works?filter=doi:...,type:article` → abstract + `is_final`
   - `is_final=false` → skip (preprint, chapitre de livre, etc.)
   - Articles sans DOI → lookup individuel par titre + ISSN
7. **Sources OpenAlex directes** (MDPI et similaires) : `fetchRecentByIssn(issn, 7)` avec `filter=type:article`. Vérification `is_final` en plus.
8. **Insert en base** : batch de 50 → `veille_items`.
9. **Scoring** : embed abstract → `match_chunks` → `similarity_score` (0–1 vs corpus PDF).
10. **Fin de run** : `completeRun(runId, ‘completed’|’failed’)`.

---

## 3. Garde-fous publications finales

| Garde-fou | Où | Rôle |
|-----------|-----|------|
| **Filtre source active** | `sources.ts` | `.eq(‘active’, true)` — sources désactivées ignorées |
| **Filtre éditorial titre** | `fetch-rss.ts` | Regex corrections/errata/rétractations |
| **Filtre date 7 jours** | `pipeline.ts` | `isRecent()` — articles trop anciens ignorés |
| **Dédup DOI** | `pipeline.ts` | `getKnownDois()` — articles déjà en base ignorés |
| **Filtre type:article API** | `openalex.ts` | Seuls les `journal-article` retournés par OpenAlex |
| **Vérification is_final** | `pipeline.ts` | Double protection côté client (`type=article && primary_location.source`) |
| **Skip + log** | `pipeline.ts` | Erreur sur un item → log + continuation |

---

## 4. Décisions validées

| Sujet | Décision |
|-------|----------|
| **Déclenchement** | UI (bouton) + cron Vercel 6h UTC. |
| **Run** | Toutes les sources actives d’un coup. |
| **Sources** | 100 % en base Supabase — gérables depuis l’UI (page `/bibliographie/sources`). |
| **Dédup** | Par DOI uniquement — suffisant pour les journaux à comité de lecture. |
| **Publications finales** | Filtre `type:article` OpenAlex (API) + vérification `is_final` (client). |
| **Scoring** | Embedding abstract vs corpus PDF → `similarity_score` 0–1. Seuls les articles avec abstract sont scorés. |
| **Erreurs** | Skip + log ; `last_error` sur item ou run ; pas de table dédiée. |

---

## 5. Structure de code (lib/veille)

| Fichier | Responsabilité |
|---------|----------------|
| **sources.ts** | `getRssSources()` + `getOpenAlexSources()` depuis Supabase (filtre `active=true`). |
| **fetch-rss.ts** | Parse flux RSS → titre, DOI, abstract, auteurs. Filtre éditorial. |
| **openalex.ts** | Fetch abstracts (batch DOI), lookup DOI par titre, fetch par ISSN. Filtre `type:article`. |
| **pipeline.ts** | Orchestrateur 8 phases — fetch, dédup, enrichissement, insert, score. |
| **score.ts** | Embed abstract → `match_chunks` → similarité vs corpus. |

---

## 6. Flux résumé

1. UI/cron → `createRun()` → `veille_runs (status=running)`.
2. `getRssSources()` (active=true) → fetch RSS parallèle → filtre éditorial + date + DOI.
3. Batch OpenAlex (type:article) → abstracts + is_final → skip si non-journal.
4. `getOpenAlexSources()` (active=true) → `fetchRecentByIssn` (type:article) → is_final.
5. Insert batch 50 → `veille_items`.
6. Score abstracts → `similarity_score`.
7. `completeRun(‘completed’|’failed’)`.  
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
