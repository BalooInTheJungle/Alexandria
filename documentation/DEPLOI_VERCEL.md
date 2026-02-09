# Déploiement sur Vercel

Ce guide décrit comment héberger **Alexandria** sur Vercel (offre gratuite) pour rendre l’application accessible en ligne.

## Prérequis

- Un **compte Vercel** (gratuit) : [vercel.com](https://vercel.com)
- Le dépôt **GitHub** à jour : `BalooInTheJungle/Alexandria` (ou le tien)
- Un projet **Supabase** (auth + base de données)
- Une clé **OpenAI** (pour le RAG)

---

## 1. Importer le projet sur Vercel

1. Va sur [vercel.com](https://vercel.com) et connecte-toi (ou crée un compte).
2. **Add New…** → **Project**.
3. **Import Git Repository** : choisis **GitHub** et autorise Vercel si besoin.
4. Sélectionne le dépôt **Alexandria** (ou ton fork).
5. **Branch** : laisse `main` (ou la branche que tu veux déployer).
6. **Framework Preset** : Vercel détecte Next.js automatiquement.
7. Ne clique pas encore sur **Deploy** : configure d’abord les variables d’environnement (étape 2).

---

## 2. Variables d’environnement

Dans la page du projet (avant ou après le premier déploiement) :

**Settings** → **Environment Variables**

Ajoute les variables suivantes pour **Production** (et **Preview** si tu veux que les PR soient déployées) :

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Oui | Supabase → **Settings** → **API** → **Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Oui | Même page → **anon** / **public** |
| `SUPABASE_SERVICE_ROLE_KEY` | Oui | Même page → **service_role** (secret, ne pas exposer côté client) |
| `OPENAI_API_KEY` | Oui (pour le RAG) | Clé API OpenAI |
| `CRON_SECRET` | Optionnel | Chaîne secrète pour protéger l’appel au cron (voir § 4) |

Tu peux t’inspirer de ton fichier `.env.local` en local (sans le committer). Les valeurs doivent correspondre au projet Supabase et au compte OpenAI que tu utilises en production.

Après avoir ajouté les variables, lance ou relance un **Deploy** (ou **Redeploy** sur le dernier déploiement).

---

## 3. Supabase : URL de redirection

Pour que la **connexion / déconnexion** fonctionne sur l’URL Vercel :

1. Supabase → **Authentication** → **URL Configuration**.
2. **Redirect URLs** : ajoute l’URL de ton déploiement, par exemple :
   - `https://alexandria-xxx.vercel.app/**`
   - ou ton domaine personnalisé si tu en as un.
3. (Optionnel) Pour les **preview deployments** (chaque PR) :  
   `https://*.vercel.app/**`

Sans cette étape, après login tu peux avoir une erreur de redirection ou rester sur la page de login.

---

## 4. Cron (optionnel) : rétention 30 jours

Le projet définit un cron dans `vercel.json` qui appelle `/api/cron/retention` tous les jours à 4h UTC.

- **Sans config** : la route existe mais Vercel ne l’appellera pas automatiquement (ou sans secret). Tu peux l’appeler à la main avec `?secret=xxx` si tu as défini `CRON_SECRET`.
- **Avec config** : dans Vercel → **Settings** → **Crons**, le cron est pris en compte. Définis **CRON_SECRET** dans les variables d’environnement et utilise la même valeur dans la config du cron (Authorization Bearer) si tu veux sécuriser l’appel.

Si tu ne configures pas le cron, le reste de l’app (RAG, bibliographie, auth) fonctionne normalement.

---

## 5. Vérifications après déploiement

1. **URL** : ouvre l’URL fournie par Vercel (ex. `https://alexandria-xxx.vercel.app`).
2. **Login** : tu devrais être redirigé vers `/login` puis, après connexion, vers `/rag` (ou la page protégée).
3. **RAG** : ouvre une conversation, envoie une question ; si les env vars (Supabase + OpenAI) sont correctes, tu dois avoir une réponse.
4. **Paramètres RAG** : `/rag/settings` doit afficher et enregistrer les paramètres (Supabase + API settings).

En cas d’erreur 500 ou de message d’erreur, consulte les **logs** dans Vercel → **Deployments** → clic sur le déploiement → **Functions** / **Runtime Logs**.

---

## 6. Build local (avant de pousser)

Pour éviter les échecs de build sur Vercel, vérifie en local :

```bash
npm install
npm run build
```

Si `npm run build` réussit, le build Vercel a de bonnes chances de passer (même Node, même commande). Les avertissements npm (deprecated) ou webpack (cache) n’empêchent en général pas le déploiement.

---

## 7. Fichiers utiles

- **next.config.js** : configuration Next.js (ex. `serverComponentsExternalPackages` pour `@xenova/transformers`).
- **vercel.json** : crons (ex. `/api/cron/retention`).
- **.env.local.example** : liste des variables d’environnement à définir (ne pas committer `.env.local`).

---

## Résumé

1. Importer le repo GitHub dans Vercel.
2. Ajouter les variables d’environnement (Supabase + OpenAI + optionnellement CRON_SECRET).
3. Configurer les Redirect URLs dans Supabase avec l’URL Vercel.
4. Déployer (ou redéployer) et tester login + RAG.
5. Optionnel : configurer le cron et CRON_SECRET pour la rétention.

En cas d’erreur au build ou au runtime, les messages dans **Vercel → Deployments → Logs** permettent de corriger (variables manquantes, erreur Supabase/OpenAI, etc.).
