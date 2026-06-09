# Refactoring pipeline veille — GitHub Actions multi-jobs

## Contexte & problème

Le pipeline actuel est un bloc monolithique (~327 lignes, `lib/veille/pipeline.ts`) déclenché
par un appel HTTP depuis GitHub Actions vers Vercel. Il y a deux problèmes structurels :

1. **Vercel Hobby = 10s max** par serverless function. `waitUntil` ne fonctionne pas sur Hobby.
   Le pipeline (~200s minimum) **timeout systématiquement**, d'où les `similarity_score = null`.

2. **Monolithe sans retry** : si le scoring plante au milieu, tout est perdu. Pas de traçabilité
   par phase, pas de reprise possible.

---

## Architecture cible

**GitHub Actions exécute directement des scripts Node.js** (accès Supabase via secrets).
Vercel ne sert plus qu'à l'UI — aucune logique lourde côté Vercel.

```
GitHub Actions Workflow (1x/jour, heure à définir)
│
├── Job 1 : extract    (~2-3 min)
│   scripts/veille/extract.ts
│   → Fetch RSS + OpenAlex
│   → Filtre garde-fou (finalisé + abstract requis + pas ASAP/corrections)
│   → Insert dans veille_items (similarity_score = NULL = "à scorer")
│   → Crée le veille_run en DB
│
├── Job 2 : score      (~10-20 min) — needs: extract
│   scripts/veille/score.ts
│   → Charge tous les items du run avec similarity_score IS NULL
│   → embed abstract → match_chunks RPC → similarity_score + corpus_refs
│   → Update en DB par batch de 50
│   → Pas de cap MAX_ITEMS : score TOUT le run
│
├── Job 3 : recap-articles  (~2 min) — needs: score
│   scripts/veille/recap-articles.ts
│   → Charge les articles du run avec similarity_score >= SEUIL (défaut 0.75)
│   → GPT-4o-mini → ai_analysis (contribution, relevance, corpus_link) par article
│   → Update veille_items.ai_analysis
│
└── Job 4 : recap-global    (~1 min) — needs: recap-articles
    scripts/veille/recap-global.ts
    → Charge les articles analysés du run
    → GPT-4o-mini → ai_summary global (thèmes + synthèse)
    → Update veille_runs.ai_summary + high_score_count
```

### Statut implicite par champ DB (sans nouvelle colonne)

| État           | Condition DB                              |
|----------------|-------------------------------------------|
| Extrait        | `veille_items` row existe                 |
| Scoré          | `similarity_score IS NOT NULL`            |
| Analysé        | `ai_analysis IS NOT NULL`                 |
| Run terminé    | `veille_runs.status = 'completed'`        |

---

## Réutilisation du code existant

Les scripts importent directement les modules `lib/veille/` et `lib/db/` — pas de réécriture.

| Module existant            | Utilisé par              |
|----------------------------|--------------------------|
| `lib/veille/sources.ts`    | extract.ts               |
| `lib/veille/fetch-rss.ts`  | extract.ts               |
| `lib/veille/openalex.ts`   | extract.ts               |
| `lib/veille/crossref.ts`   | extract.ts               |
| `lib/veille/score.ts`      | score.ts                 |
| `lib/veille/summarize.ts`  | recap-articles.ts, recap-global.ts |
| `lib/db/veille.ts`         | tous                     |

---

## Fichiers à créer / modifier

| Fichier                                          | Action   | État    |
|--------------------------------------------------|----------|---------|
| `docs/VEILLE_PIPELINE_REFACTOR.md`               | Créer    | ✅ Fait  |
| `tsconfig.scripts.json`                          | Créer    | ✅ Fait  |
| `.github/workflows/veille-cron.yml`              | Modifier | ✅ Fait  |
| `scripts/veille/extract.ts`                      | Créer    | ✅ Fait  |
| `scripts/veille/score.ts`                        | Créer    | ⬜ À faire |
| `scripts/veille/recap-articles.ts`               | Créer    | ⬜ À faire |
| `scripts/veille/recap-global.ts`                 | Créer    | ⬜ À faire |
| `lib/veille/pipeline.ts`                         | Garder   | ⚠️ Conservé pour déclenchement manuel UI |
| `app/api/cron/veille/route.ts`                   | Garder   | ⚠️ Conservé pour déclenchement manuel UI |

---

## Workflow GitHub Actions cible

```yaml
# 1 run/jour — heure à choisir (publication asiatique ~0h UTC, européenne ~8h UTC, US ~14h UTC)
# On choisit 10h UTC (12h Paris) pour couvrir le max de publications du matin

jobs:
  extract:
    # ~3 min
    runs-on: ubuntu-latest
    outputs:
      run_id: ${{ steps.run.outputs.run_id }}
    steps:
      - run: npx ts-node scripts/veille/extract.ts

  score:
    needs: extract
    # ~10-20 min — pas de timeout Vercel
    runs-on: ubuntu-latest
    steps:
      - run: npx ts-node scripts/veille/score.ts --run-id ${{ needs.extract.outputs.run_id }}

  recap-articles:
    needs: score
    # ~2 min
    runs-on: ubuntu-latest
    steps:
      - run: npx ts-node scripts/veille/recap-articles.ts --run-id ${{ needs.extract.outputs.run_id }}

  recap-global:
    needs: recap-articles
    # ~1 min
    runs-on: ubuntu-latest
    steps:
      - run: npx ts-node scripts/veille/recap-global.ts --run-id ${{ needs.extract.outputs.run_id }}
```

Le `run_id` est passé entre jobs via les outputs GitHub Actions.

---

## Points d'attention / décisions

### Retry sur le scoring
Chaque script `score.ts` charge les items `WHERE similarity_score IS NULL AND run_id = ?`.
Si le job échoue à mi-chemin et est relancé manuellement, il reprend là où il s'est arrêté.

### Cap MAX_ITEMS supprimé
Actuellement 300 articles max/run. Avec GitHub Actions, pas de raison de cap :
1500 articles × 200ms moyen = ~5 min de scoring (concurrence 10).

### Concurrence scoring
Passer de 5 → 10 maintenant qu'on n'est plus limité par Vercel.
Supabase Pro supporte ~100 connexions simultanées, 10 est safe.

### Switch stratégie (sans toucher au code)

Le workflow lit la stratégie dans cet ordre de priorité :
1. `workflow_dispatch` input `strategy` (pour tests manuels)
2. Secret GitHub `VEILLE_STRATEGY` (pour basculer sans push)
3. Défaut hardcodé `actions` dans le workflow

| Valeur | Comportement |
|--------|-------------|
| `actions` | Scripts Node.js directs — recommandé, pas de timeout |
| `legacy` | Appel HTTP vers Vercel — rollback rapide si problème |

**Pour revenir à l'ancienne méthode en urgence :** dans GitHub → Settings → Secrets, ajouter `VEILLE_STRATEGY = legacy`. Pas besoin de toucher au code.

### Secrets GitHub requis (stratégie `actions`)
```
NEXT_PUBLIC_SUPABASE_URL   = URL Supabase
SUPABASE_SERVICE_ROLE_KEY  = clé service role
OPENAI_API_KEY             = clé OpenAI
VEILLE_STRATEGY            = "actions" (optionnel, c'est le défaut)
```

### Secrets conservés pour la stratégie `legacy`
```
CRON_SECRET      = secret pour l'endpoint Vercel
VERCEL_APP_URL   = https://alexandria-dusky.vercel.app
```

---

## Ce qui NE change PAS

- Le schéma DB (aucune migration nécessaire)
- Les routes API Vercel (UI inchangée)
- La logique de scoring, le prompt GPT, les filtres garde-fou
- La page historique, les KPIs, les logs pipeline

---

## Problèmes connus du pipeline actuel (référence)

| Problème                         | Cause                              | Fix dans la nouvelle archi   |
|----------------------------------|------------------------------------|------------------------------|
| `similarity_score = null`        | Vercel 10s timeout                 | ✅ GitHub Actions = pas de timeout |
| Scoring incomplet                | `MAX_ITEMS = 300` + timeout        | ✅ Score tout, pas de cap     |
| Pas de retry                     | Monolithe tout-ou-rien             | ✅ Jobs séparés, reprise auto |
| `getKnownDois()` silently fails  | Timeout 20s                        | ✅ En dehors de Vercel = OK   |
| `saveItemsAiAnalysis()` O(n) seq | Boucle séquentielle                | ⚠️ À optimiser (batch CASE WHEN) |
| MAX_ARTICLES 8 vs 10 incohérent  | Constantes dupliquées              | ✅ Centralisé dans recap-articles.ts |
| DST bug (hiver UTC+1)            | Cron UTC fixe                      | ⚠️ À surveiller (hors scope) |
