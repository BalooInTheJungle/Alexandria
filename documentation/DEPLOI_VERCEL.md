# Déploiement — Vercel + GitHub Actions

Ce guide décrit comment héberger **Alexandria** en production. Depuis la migration de la veille vers GitHub Actions, **deux plateformes** sont impliquées, pas une seule.

> Réécrit le 06/07/2026. Changement principal : Vercel héberge **uniquement le front + les API de lecture** ; la pipeline veille tourne entièrement dans **GitHub Actions**, avec ses propres secrets à configurer séparément. Le login redirige vers `/bibliographie` (pas `/rag`, page retirée en juin 2026).

## Prérequis

- Un **compte Vercel** : [vercel.com](https://vercel.com)
- Le dépôt **GitHub** à jour
- Un projet **Supabase** (Postgres + pgvector + Auth + **Storage**)
- Une clé **OpenAI**
- (Optionnel) Une clé **Semantic Scholar** (`SS_API_KEY`) pour éviter le rate-limit 1 req/s

---

## 1. Importer le projet sur Vercel

1. [vercel.com](https://vercel.com) → **Add New…** → **Project**.
2. **Import Git Repository** → sélectionner le dépôt.
3. **Branch** : `main`.
4. Next.js détecté automatiquement.
5. Ne pas déployer avant d'avoir configuré les variables d'environnement (étape 2).

---

## 2. Variables d'environnement Vercel

**Settings** → **Environment Variables** (Production, et Preview si besoin) :

| Variable | Obligatoire | Description |
|----------|-------------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Oui | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Oui | Même page → anon/public |
| `SUPABASE_SERVICE_ROLE_KEY` | Oui | Même page → service_role (secret) |
| `OPENAI_API_KEY` | Oui | Clé OpenAI (chat RAG/Analyse + veille legacy si utilisée) |
| `CRON_SECRET` | Recommandé | Protège `/api/cron/retention` et `/api/cron/veille` (repli legacy) |
| `SS_API_KEY` | Optionnel | Absent de `.env.example` mais lu par `app/api/analyse/[id]/insights/route.ts` et le script `extract-semanticscholar.ts` — sans clé, rate-limit Semantic Scholar 1 req/s |

> **Variables mortes dans `.env.example`** : `VEILLE_MAX_URLS_PER_RUN` et `VEILLE_MAX_URLS_PER_SOURCE` ne sont référencées par **aucun fichier `.ts` du projet** — reliquat de l'ancien pipeline scraping+LLM (quotas d'URLs). Ne pas s'appuyer dessus, elles n'ont aucun effet aujourd'hui.

Après ajout des variables → **Deploy** / **Redeploy**.

---

## 3. Secrets GitHub Actions (pipeline veille — indépendant de Vercel)

Depuis la migration décrite dans `docs/VEILLE_PIPELINE_REFACTOR.md`, **la veille ne tourne plus sur Vercel**. Le workflow `.github/workflows/veille-cron.yml` a besoin de ses propres secrets, configurés dans **GitHub → Settings → Secrets and variables → Actions** :

| Secret | Obligatoire | Rôle |
|--------|-------------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Oui | Même valeur que sur Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Oui | Même valeur que sur Vercel |
| `OPENAI_API_KEY` | Oui | Pour `recap-articles.ts` / `recap-global.ts` |
| `VEILLE_STRATEGY` | Optionnel | `actions` (défaut) ou `legacy` (appel HTTP vers `/api/cron/veille` sur Vercel, nécessite alors `CRON_SECRET` + `VERCEL_APP_URL`) |
| `CRON_SECRET`, `VERCEL_APP_URL` | Seulement si `legacy` | Repli d'urgence uniquement |

**Variable repo** (`Settings → Secrets and variables → Actions → Variables`, pas `Secrets`) :

| Variable | Rôle |
|----------|------|
| `ENABLE_SEMANTIC_SCHOLAR` | `true` pour activer le Job 1b (recommandations Semantic Scholar) |

Sans ces secrets GitHub configurés séparément des variables Vercel, **la veille ne tournera pas du tout**, même si Vercel est parfaitement configuré — c'est une source d'erreur fréquente depuis la migration.

---

## 4. Supabase — configuration complémentaire

### 4.1 URL de redirection Auth

1. Supabase → **Authentication** → **URL Configuration**.
2. **Redirect URLs** : ajouter l'URL Vercel (`https://ton-domaine.vercel.app/**`), et `https://*.vercel.app/**` pour les preview deployments si besoin.

### 4.2 Storage bucket `analyses` (non documenté auparavant)

Le module Analyse stocke les PDF uploadés dans un bucket Supabase Storage nommé **`analyses`** (`app/api/analyse/upload/route.ts`, `app/api/analyse/[id]/pdf/route.ts`). **Ce bucket doit exister** dans le projet Supabase (Storage → New bucket → `analyses`) — sans lui, l'upload dans le module Analyse échoue. Vérifier sa présence et ses policies RLS lors d'un nouveau déploiement / nouveau projet Supabase.

---

## 5. Cron Vercel (rétention uniquement)

`vercel.json` ne contient **qu'un seul cron** : `/api/cron/retention` à 4h UTC. Il n'y a **plus de cron veille dans `vercel.json`** — celui-ci est entièrement géré par GitHub Actions (voir §3).

- Sans `CRON_SECRET` configuré, la route `/api/cron/retention` existe mais Vercel ne l'appelle pas de façon sécurisée.
- Appel manuel : `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domaine>/api/cron/retention"`.

---

## 6. Vérifications après déploiement

1. Ouvrir l'URL Vercel.
2. **Login** → redirection vers `/login` puis, après connexion, vers **`/bibliographie`** (pas `/rag`, qui n'existe plus).
3. **Analyse** : uploader un PDF sur `/analyse`, vérifier que l'upload aboutit (bucket `analyses` correctement configuré) et que l'onglet Discussion répond (clé OpenAI + Supabase correctes).
4. **Veille** : vérifier dans GitHub → Actions que le workflow `Veille quotidienne` s'exécute et se termine en `completed` — indépendant de l'état de Vercel.

En cas d'erreur, consulter :
- **Vercel** → Deployments → Runtime Logs (front, Analyse, chat RAG, cron rétention)
- **GitHub Actions** → onglet Actions du repo → logs par job (extract/score/recap-articles/recap-global) — **ce n'est pas dans les logs Vercel**, erreur fréquente de recherche.

---

## 7. Build local (avant de pousser)

```bash
npm install
npm run build
```

---

## 8. Fichiers utiles

- `next.config.js` : `serverComponentsExternalPackages: ["@xenova/transformers", "onnxruntime-node"]`, `transpilePackages: ["react-pdf", "pdfjs-dist"]`.
- `vercel.json` : cron rétention uniquement.
- `.github/workflows/veille-cron.yml` : cron + secrets veille.
- `.env.example` : variables Vercel/local (incomplet — manquent `SS_API_KEY` et `SUPABASE_DB_URL`, utilisées par certains scripts Python).

---

## Résumé

1. Importer le repo dans Vercel, configurer les variables (Supabase + OpenAI + `SS_API_KEY` optionnel).
2. Configurer **séparément** les secrets GitHub Actions pour la veille (§3) — étape souvent oubliée car distincte de Vercel.
3. Créer le bucket Storage `analyses` dans Supabase.
4. Configurer les Redirect URLs Auth.
5. Déployer, tester login → `/bibliographie`, upload Analyse, et vérifier le run GitHub Actions du jour.
