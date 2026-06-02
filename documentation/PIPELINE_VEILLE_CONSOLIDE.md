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

1. **Lire les sources actives** : `getRssSources()` + `getOpenAlexSources()` depuis Supabase (filtre `active=true`). → phase `sources`
2. **Fetch RSS en parallèle** : 5 sources simultanées → ~16s pour 43 sources. Extraction : titre, DOI, abstract, auteurs, date.
3. **Filtre éditorial** : skip corrections, errata, rétractations (regex sur le titre).
4. **Filtre date** : articles > 7 jours → skip.
5. **Dédup DOI** : comparaison avec `getKnownDois()` (tous les DOIs déjà en base). → phase `urls`
6. **Enrichissement OpenAlex** (batch cross-sources) :
   - DOIs sans abstract → batch `/works?filter=doi:...,type:article` → abstract + `is_final`
   - `is_final=false` → skip (preprint, chapitre de livre, etc.)
   - Articles sans DOI → lookup individuel par titre + ISSN
7. **Sources OpenAlex directes** (MDPI et similaires) : `fetchRecentByIssn(issn, 7)` avec `filter=type:article`. Vérification `is_final` en plus.
8. **Insert en base** : batch de 50 → `veille_items`. → phase `items` (items_processed=0, items_total=N)
9. **Scoring double** : → phase `items` (progression par paliers de 50)
   - `similarity_score` : embed abstract → `match_chunks` → similarité 0–1 vs corpus PDF
   - `heuristic_score` : count de termes du corpus (radicaux tsvector) trouvés dans l’abstract → 0–1. Termes chargés une fois depuis `corpus_top_terms_cache` (RPC `get_corpus_top_terms(80)`).
   - Les deux scores sont stockés en un seul update par item via `updateVeilleItemBothScores`.
10. **Résumé IA** : → phase `summary`
    - Sélection des articles avec `similarity_score >= 0.75` (seuil configurable).
    - Pour chacun des 15 meilleurs : fetch des 2 chunks corpus les plus proches via `match_chunks` (avec `doc_title`).
    - Appel GPT-4o-mini : thèmes émergents + actions prioritaires par article citant le corpus.
    - Stockage dans `veille_runs.ai_summary` + `high_score_count` + `score_threshold`.
11. **Fin de run** : → phase `done` puis `completeRun(runId, ‘completed’|’failed’)`.

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
| **Scoring similarity** | Embedding abstract vs corpus PDF → `similarity_score` 0–1. Seuls les articles avec abstract sont scorés. |
| **Scoring heuristique** | Radicaux tsvector du corpus (top 80 depuis cache) comptés dans l'abstract → `heuristic_score` 0–1. Informatif, non utilisé dans le score final affiché. |
| **Score final affiché** | `similarity_score` uniquement (la moyenne heuristique+vectorielle a été abandonnée — heuristique trop comprimé). |
| **Résumé IA** | GPT-4o-mini sur top 15 articles ≥ 0.75 avec chunks corpus pour contextualisation. |
| **Erreurs** | Skip + log ; `last_error` sur item ou run ; pas de table dédiée. |

---

## 5. Structure de code (lib/veille)

| Fichier | Responsabilité |
|---------|----------------|
| **sources.ts** | `getRssSources()` + `getOpenAlexSources()` depuis Supabase (filtre `active=true`). |
| **fetch-rss.ts** | Parse flux RSS → titre, DOI, abstract, auteurs. Filtre éditorial. |
| **openalex.ts** | Fetch abstracts (batch DOI), lookup DOI par titre, fetch par ISSN. Filtre `type:article`. |
| **pipeline.ts** | Orchestrateur 11 phases — fetch, dédup, enrichissement, insert, score, résumé IA. Met à jour `phase`, `items_processed`, `items_total` sur `veille_runs` à chaque étape. |
| **score.ts** | `scoreVeilleItems()` : embed → `match_chunks` → similarity. `loadCorpusTerms()` : top 80 radicaux depuis cache. `scoreHeuristic()` : count radicaux dans abstract. Callback `onProgress` pour mise à jour live toutes les 50 items. |
| **summarize.ts** | `generateVeilleSummary()` : fetch chunks corpus (avec `doc_title`) pour chaque top article → GPT-4o-mini → résumé FR avec thèmes + actions. |

---

## 6. Flux résumé

1. UI/cron → `createRun()` → `veille_runs (status=running)`.
2. `updateRunPhase(‘sources’)` → `getRssSources()` → fetch RSS parallèle → filtre éditorial + date + DOI.
3. `updateRunPhase(‘urls’)` → Batch OpenAlex (type:article) → abstracts + is_final → skip si non-journal.
4. `getOpenAlexSources()` → `fetchRecentByIssn` → is_final.
5. `updateRunPhase(‘items’, 0, N)` → Insert batch 50 → `veille_items`.
6. Score abstracts → `similarity_score` + `heuristic_score` (progress toutes les 50 via `onProgress`).
7. `updateRunPhase(‘summary’)` → GPT-4o-mini sur top articles ≥ 0.75 → `ai_summary` + `high_score_count`.
8. `updateRunPhase(‘done’)` → `completeRun(‘completed’|’failed’)`.

---

---

## 7. Règles critiques — background Vercel (`waitUntil`)

Ces règles s'appliquent à tout code qui tourne dans un contexte `waitUntil` (pipeline veille, crons background).

### ❌ Ne jamais faire

| Interdit | Raison |
|----------|--------|
| `new OpenAI({ apiKey })` + `.chat.completions.create()` | Le SDK OpenAI utilise `undici` comme client HTTP interne. `undici` échoue à établir des connexions TCP dans un contexte `waitUntil` de longue durée (> ~150s). |
| `await createClient()` (client RLS) pour lire `veille_runs` ou `veille_items` | Sans session utilisateur authentifiée, le RLS retourne 0 lignes silencieusement — pas d'erreur, juste des données vides. |
| `fetch(url)` sans timeout | Si la cible ne répond pas, le pipeline se bloque indéfiniment. `waitUntil` est tué silencieusement par Vercel, le run reste en `status=running` pour toujours. |
| `process.env.VERCEL_URL` pour construire des URLs internes | Retourne l'URL de déploiement spécifique (protégée par Vercel Auth → HTTP 401). |

### ✅ Toujours faire

| Règle | Détail |
|-------|--------|
| **`fetch` natif pour OpenAI** | `fetch('https://api.openai.com/v1/chat/completions', { ... })` fonctionne dans `waitUntil`. |
| **Client admin pour les requêtes DB** dans les crons | `getAdminSupabase()` (service role) pour toutes les lectures/écritures dans le pipeline. |
| **`AbortSignal.timeout(N)` sur tous les `fetch`** | Évite tout blocage silencieux. |
| **`VERCEL_APP_URL`** pour les URLs internes | Variable définie manuellement dans Vercel Settings → `https://alexandria-dusky.vercel.app`. |

### Clients Supabase — qui utilise quoi

| Contexte | Client à utiliser | Fichier |
|----------|-------------------|---------|
| Pipeline veille, crons | `getAdminSupabase()` (service role) | `lib/db/veille.ts` |
| Routes API utilisateur (RAG, etc.) | `createClient()` (RLS avec session) | `lib/supabase/server.ts` |
| Composants React client | `createClient()` browser | `lib/supabase/client.ts` |

---

## 9. Références

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Besoins, flows d’usage veille. |
| **Fonctionnalités Front** | Liste rankée, bouton de déclenchement, affichage. |
| **Schéma DB et données** | Tables `sources`, `veille_runs`, `veille_items`. |
