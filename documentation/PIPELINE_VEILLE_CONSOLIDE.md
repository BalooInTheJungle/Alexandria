# Pipeline veille — condensé

**Rôle** : référence unique du module **Veille** : étapes, garde-fous, décisions, structure de code.

> Réécrit le 06/07/2026. La version précédente décrivait le pipeline **monolithique** `lib/veille/pipeline.ts` (déclenchement manuel UI + cron Vercel) comme architecture principale. Depuis `docs/VEILLE_PIPELINE_REFACTOR.md`, l'architecture **par défaut en production** est **4 jobs GitHub Actions séquentiels** (`scripts/veille/*.ts`), déclenchés automatiquement chaque jour. `pipeline.ts` existe encore mais n'est plus que le chemin de secours (`VEILLE_STRATEGY=legacy` ou bouton manuel).

---

## 1. Vue d'ensemble

- **Déclenchement** : automatique, **cron GitHub Actions** (workflow `.github/workflows/veille-cron.yml`, 7h UTC). Le bouton UI et `lib/veille/pipeline.ts` restent disponibles comme **repli manuel** (stratégie `legacy`, appel HTTP vers Vercel).
- **Run** : toutes les sources actives d'un coup, découpée en **4 jobs indépendants** qui se passent le `run_id` (reprise possible si un job échoue et est relancé).
- **Sources** : 100 % en base (table `sources`), 44 actives (RSS, OpenAlex direct, ou Semantic Scholar).
- **Objectif** : récupérer les articles récents, filtrer ceux réellement finalisés (pas de preprint/ASAP), les scorer vs le corpus, générer une analyse IA, et exposer le tout en lecture sur `/bibliographie`.

---

## 2. Les 4 jobs (+ 1 optionnel) — implémentation actuelle

### Job 1 — `scripts/veille/extract.ts`
1. Charge les DOIs déjà connus (`getKnownDois()`, timeout 20s, dédup désactivée si timeout).
2. Fetch RSS des sources actives, 5 en parallèle (`PARALLEL_RSS_CONCURRENCY=5`).
3. **Filtre fraîcheur** : `LOOKBACK_DAYS = 3` — articles publiés il y a plus de **3 jours** ignorés.
4. **Filtre éditorial** : regex sur le titre (corrections, errata, rétractations) dans `fetch-rss.ts`.
5. **Dédup DOI** vs base.
6. **Enrichissement OpenAlex batch** : abstracts + `is_final` pour tous les DOIs frais en un seul appel.
7. **Résolution DOI par titre** (Elsevier notamment, articles sans DOI dans le flux RSS) via `fetchDoiByTitle`.
8. **Fallback CrossRef** (`checkFinalizationByDois`) pour les DOIs qu'OpenAlex n'a pas confirmés `is_final`.
9. **Sources OpenAlex directes** (MDPI et similaires) : `fetchRecentByIssn(issn, 3)`, même double vérification `is_final` (OpenAlex + CrossRef).
10. Insert par batch de 50 dans `veille_items`. Le run reste en phase `extracted` (pas `completed` — c'est `recap-global.ts` qui clôture).

### Job 1b (optionnel) — `scripts/veille/extract-semanticscholar.ts`
Actif seulement si la variable repo GitHub `ENABLE_SEMANTIC_SCHOLAR=true`. Tourne en parallèle du Job 1, s'appuie sur `ss_representative_papers` pour interroger l'API de recommandations Semantic Scholar.

### Job 2 — `scripts/veille/score.ts`
1. Charge tous les items du run avec `similarity_score IS NULL` (reprise auto si relancé).
2. Charge les termes corpus en cache (`loadCorpusTerms(80)`) pour le score heuristique.
3. Pour chaque abstract : **découpage en chunks de ~150 mots** (recouvrement de 1 phrase, max 4 chunks) — un abstract entier embeddé en un seul vecteur perd trop d'information pour all-MiniLM-L6-v2, entraîné sur des phrases courtes.
4. Pour chaque chunk : `embedQuery()` puis **en parallèle** `match_chunks` (corpus complet) et `match_author_chunks` (articles auteur seuls), timeout 30s chacun.
5. `similarity_score` = meilleure similarité obtenue sur tous les chunks de l'abstract. `author_score` = idem restreint aux articles auteur.
6. `corpus_refs` = jusqu'à 5 passages avec similarité ≥ **0.75** (`CORPUS_REF_THRESHOLD`), dédupliqués par (titre, page).
7. `heuristic_score` = fraction des termes corpus (top 80 lexèmes) trouvés dans l'abstract — **informatif uniquement**, jamais utilisé pour le seuil d'affichage ni pour l'analyse IA.
8. Sauvegarde par batch de 50. Concurrence de scoring : **10** (vs 5 en legacy Vercel — plus de limite serverless côté GitHub Actions).

### Job 3 — `scripts/veille/recap-articles.ts`
1. Charge jusqu'à 50 articles du run avec `similarity_score ≥ 0.75` (cap de sécurité `MAX_ARTICLES=50`, mais en pratique 5-10 articles/jour dépassent ce seuil).
2. Appelle `generateVeilleSummary()` (`lib/veille/summarize.ts`) qui **ne retient que les 8 meilleurs** (`MAX_ARTICLES=8` interne) parmi les éligibles, triés par score décroissant.
3. GPT-4o-mini → `ai_analysis` (`contribution`, `relevance`, `corpus_link`) par article, sauvegardé un par un.

> ⚠️ **Important pour le mémoire** : un article ≥75% n'est donc pas garanti d'obtenir un `ai_analysis` — seuls les **8 mieux scorés du jour** sont envoyés à GPT pour l'analyse individuelle. Au-delà de 8 articles ≥75% dans une même run, les suivants restent sans `ai_analysis`.

### Job 4 — `scripts/veille/recap-global.ts`
1. Charge les articles du run avec `ai_analysis` non-null **ET `similarity_score ≥ 0.80`** (`SCORE_THRESHOLD=0.80`, différent du seuil 0.75 utilisé partout ailleurs).
2. GPT-4o-mini → thèmes transversaux + synthèse globale, à partir des `ai_analysis` déjà générés (pas des abstracts bruts).
3. Fusionne avec les `ai_analysis` en base → `veille_runs.ai_summary` = `{ themes, articles, synthesis }`.
4. Marque le run `status=completed`, `phase=done`.

> ⚠️ **Seuil à deux vitesses** : la synthèse globale (thèmes + texte de synthèse) ne considère que les articles ≥80%, alors que l'affichage front, les `corpus_refs` et l'analyse individuelle utilisent 0.75. Un article à 76% peut donc apparaître sur `/bibliographie` avec son `ai_analysis`, sans être mentionné dans la synthèse du jour.

---

## 3. Garde-fous publications finales

| Garde-fou | Où | Rôle |
|-----------|-----|------|
| Filtre source active | `sources.ts` | `active=true` uniquement |
| Filtre éditorial titre | `fetch-rss.ts` | Regex corrections/errata/rétractations |
| Filtre fraîcheur **3 jours** | `extract.ts` (`isRecent`) | Articles trop anciens ignorés |
| Dédup DOI | `extract.ts` (`getKnownDois`) | Articles déjà en base ignorés |
| Filtre `type:article` | `openalex.ts` | Seuls les `journal-article` retenus |
| Vérification `is_final` | `extract.ts` | OpenAlex batch, puis **fallback CrossRef** si non confirmé |
| Index unique DOI (DB) | migration `20260608100000` | Un seul `veille_items` par DOI, y compris entre runs |
| Skip + log | `extract.ts`, `score.ts` | Erreur sur un item → log (`pipeline_logs`) + continuation |

---

## 4. Décisions actuelles (vérifiées dans le code)

| Sujet | Décision réelle |
|-------|----------|
| **Déclenchement** | Cron GitHub Actions 7h UTC (défaut `actions`), repli manuel UI (`legacy`, Vercel) |
| **Fenêtre de fraîcheur** | **3 jours** dans le pipeline actif (`extract.ts`), 7 jours dans le pipeline legacy (`lib/veille/pipeline.ts`) — **incohérence à trancher**, voir §7 |
| **Dédup** | DOI uniquement, contrainte unique en base |
| **Publications finales** | `type:article` OpenAlex + `is_final` (OpenAlex puis CrossRef en fallback) |
| **Scoring similarity** | Abstract découpé en chunks ~150 mots, embeddings multiples, meilleure similarité retenue. Corpus complet (`similarity_score`) + articles auteur seuls (`author_score`) en parallèle |
| **Scoring heuristique** | Fraction de termes corpus (top 80) trouvés dans l'abstract — informatif, non utilisé dans l'affichage |
| **Score affiché / filtre display** | `similarity_score` ≥ 0.75 |
| **Analyse IA individuelle** | GPT-4o-mini sur le **top 8** des articles ≥ 0.75 |
| **Synthèse globale du run** | GPT-4o-mini sur les articles ≥ **0.80** ayant un `ai_analysis` |
| **Erreurs** | Skip + log ; `last_error` sur item, `pipeline_logs` sur run |

---

## 5. Structure de code

### Pipeline actif (GitHub Actions)
| Fichier | Responsabilité |
|---------|----------------|
| `scripts/veille/extract.ts` | Job 1 — orchestrateur extraction (RSS + OpenAlex + CrossRef + filtres) |
| `scripts/veille/extract-semanticscholar.ts` | Job 1b — recommandations Semantic Scholar (optionnel) |
| `scripts/veille/score.ts` | Job 2 — orchestrateur scoring (charge, score, sauvegarde) |
| `scripts/veille/recap-articles.ts` | Job 3 — analyse IA individuelle |
| `scripts/veille/recap-global.ts` | Job 4 — synthèse globale + clôture du run |
| `scripts/veille/score-author.ts` | Script rétroactif : calcule `author_score` sur les items existants |

### Modules partagés (`lib/veille/`)
| Fichier | Responsabilité |
|---------|----------------|
| `sources.ts` | `getRssSources()` / `getOpenAlexSources()` (filtre `active=true`) |
| `fetch-rss.ts` | Parse RSS → titre, DOI, abstract, auteurs ; filtre éditorial |
| `openalex.ts` | Abstracts batch par DOI, résolution DOI par titre, fetch par ISSN, filtre `type:article` |
| `crossref.ts` | Fallback de vérification `is_final` quand OpenAlex ne confirme pas |
| `score.ts` | `scoreVeilleItems()`, `loadCorpusTerms()`, `scoreHeuristic()` — logique de scoring par chunks |
| `summarize.ts` | `generateVeilleSummary()` (top 8, seuil 0.75), `parseSummary()` |
| `clean-article-html.ts` | Nettoyage HTML des extraits d'articles pour l'affichage |
| `filter-article-display.ts` | Filtre d'affichage front (seuil 75%) |
| `detect-bot-challenge.ts` | Détection page anti-bot (source RSS bloquée) |
| `pipeline.ts` | **Legacy** — orchestrateur monolithique 7 jours, conservé pour le déclenchement manuel UI |

---

## 6. Flux résumé (pipeline actif)

1. GitHub Actions (7h UTC) → Job 1 `extract.ts` : crée `veille_runs`, fetch + filtre + insert → phase `extracted`.
2. (parallèle) Job 1b `extract-semanticscholar.ts` si activé.
3. Job 2 `score.ts` (needs: extract) : scoring complet, pas de cap → phase `scored`.
4. Job 3 `recap-articles.ts` (needs: score) : top 8 ≥75% → `ai_analysis` → phase `recap_articles_done`.
5. Job 4 `recap-global.ts` (needs: recap-articles) : synthèse ≥80% → `ai_summary`, `status=completed`, phase `done`.
6. Front `/bibliographie` lit uniquement via `/api/veille/*` (aucune écriture déclenchée par une visite utilisateur).

---

## 7. Règles critiques — background Vercel (`waitUntil`)

Ces règles concernent le chemin **legacy** (`lib/veille/pipeline.ts`, déclenchement manuel UI) et tout code Analyse tournant en `waitUntil` sur Vercel — **pas** les scripts GitHub Actions, qui n'ont pas ces contraintes serverless.

### ❌ Ne jamais faire (contexte Vercel `waitUntil`)

| Interdit | Raison |
|----------|--------|
| `new OpenAI({ apiKey })` + `.chat.completions.create()` | `undici` (client HTTP interne du SDK) échoue en TCP dans un `waitUntil` long (> ~150s) |
| `await createClient()` (client RLS) pour lire `veille_runs`/`veille_items` | Sans session utilisateur, RLS retourne 0 lignes silencieusement |
| `fetch(url)` sans timeout | Blocage indéfini si la cible ne répond pas ; `waitUntil` tué silencieusement par Vercel |
| `process.env.VERCEL_URL` pour des URLs internes | Retourne l'URL de déploiement, protégée par Vercel Auth (401) |

### ✅ Toujours faire

| Règle | Détail |
|-------|--------|
| `fetch` natif pour OpenAI | Fonctionne dans `waitUntil`, contrairement au SDK |
| Client admin pour les requêtes DB en cron/legacy | `getAdminSupabase()` (service role) |
| `AbortSignal.timeout(N)` sur tous les `fetch` | Évite tout blocage silencieux |
| `VERCEL_APP_URL` pour les URLs internes | Variable manuelle dans Vercel Settings |

Les scripts GitHub Actions (`scripts/veille/*.ts`) suivent déjà ces règles nativement (fetch natif OpenAI, client admin, `AbortSignal.timeout`), sans les contraintes `waitUntil` puisqu'ils tournent sur un runner classique (pas de limite 10s/150s).

---

## 8. Références

| Document | Contenu |
|----------|---------|
| `docs/VEILLE_PIPELINE_REFACTOR.md` | Historique de la migration Vercel → GitHub Actions |
| `documentation/STRUCTURE_ET_ARCHITECTURE.md` | Vue d'ensemble modules et dossiers |
| `documentation/SCHEMA_DB_ET_DONNEES.md` | Tables `sources`, `veille_runs`, `veille_items` |
| `CLAUDE.md` | Commandes, seuils résumés, état d'avancement |
