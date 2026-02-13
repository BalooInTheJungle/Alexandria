# Veille — pipeline et flux

**Référence unique** du module Veille : objectif, flux, stratégies d’extraction (RSS / HTML), structure du code, garde-fous, comment tester.

---

## 1. Vue d’ensemble

- **Déclenchement** : bouton dans l’UI (manuel). Une run peut durer longtemps → **job asynchrone** ; statut run : pending / running / completed / failed.
- **Run** : **toutes les sources d’un coup** (une run = toutes les sources en base).
- **Sources** : 100 % en base (Supabase, table `sources`) ; CRUD depuis le front (liste, ajout, modification, suppression). Colonne optionnelle `fetch_strategy` : `auto` | `fetch` | `rss`.
- **Objectif** : récupérer les **nouveaux articles** (titre, abstract, DOI, etc.), les **dédupliquer**, les **scorer** (heuristique + vectoriel) vs le corpus et afficher une **liste rankée** ; indiquer si l’article est **intégré en DB** (match DOI ou URL avec `documents`).
- **Pas de navigateur** : uniquement **fetch HTTP** ; extraction d’URLs par **flux RSS/Atom/RDF** (parse XML) ou **pages HTML** (parse cheerio). Pour les sites à contenu JS-only (ex. Nature search), utiliser l’URL d’un **flux RSS** à la place.

---

## 2. Flux de la pipeline

```
POST /api/veille/scrape (wait: false) → createRun → run en arrière-plan
         │
         ▼  listSourcesFromDb() → N sources (URL + id)
         │
         ▼  fetchSourcePages() : 1 requête HTTP par source (HTML ou XML)
         │     → Si page JS-only : 0 URL ; utiliser flux RSS pour ce domaine
         │
         ▼  Extraction URLs : RSS/Atom → extractUrlsFromRss() ; sinon → extractUrlsFromHtml() (<a href>)
         │
         ▼  Guardrails : pré-filtre (assets, CDN, analytics) → dédup URL (veille_items)
         │
         ▼  Filtre URLs : heuristique (articlelanding, /articles/…) + LLM « quelles URLs sont des articles ? » → JSON [urls]
         │     + post-filtre (cookies, login…). Échec LLM → run failed.
         │
         ▼  Quotas (maxPerRun, maxPerSource) → liste finale de candidats
         │
         ▼  Pour chaque URL : fetch HTML → clean (cheerio) → LLM (titre, auteurs, DOI, abstract, date)
         │     → scores (heuristic + similarity) → insert veille_items (skip + last_error si erreur)
         │
         ▼  update sources.last_checked_at ; veille_runs.status = completed/failed
         │
         ▼  GET /api/veille/items, /list → filterItemsForArticleDisplay() → tableau front
```

### Étapes détaillées (ordre)

1. **Lire les sources** depuis Supabase (`sources`).
2. **Fetch HTML ou XML** : une requête HTTP par source (pas de headless). Réponse = HTML (page liste) ou XML (flux RSS/Atom/RDF).
3. **Extraction d’URLs** : si XML → parse (`extractUrlsFromRss`, `<item>` / `<entry>`) ; sinon parse HTML (cheerio, `<a href>`, URLs absolues).
4. **Garde-fous avant LLM** : pré-filtrage (assets, CDN, analytics) ; **dédup par URL** (retirer les URLs déjà dans `veille_items`).
5. **Filtrage URLs** : heuristique « article évident » + LLM (liste → URLs à garder). Échec LLM → **run failed**. Post-filtre par chemin (cookies, login…).
6. **Quotas** (ex. 30/run, 10/source) sur la liste retenue.
7. **Pour chaque URL retenue** : fetch HTML page → pré-nettoyage bloc article (cheerio) → LLM extraction (titre, auteurs, DOI, abstract, date) ; skip + `last_error` si erreur.
8. **Scores** : heuristique → `heuristic_score` ; embedding abstract vs corpus → `similarity_score`.
9. **Écriture** : insertion `veille_items` (vérif DOI non déjà présent). Insert seulement si **titre OU DOI**.
10. **Front** : tableau (source, titre, auteurs, scores, intégré en DB) ; tri par score ; filtre d’affichage (exclut titres institutionnels, etc.).

---

## 3. Stratégies d’extraction (RSS vs HTML)

### RSS en priorité (aucun code en dur)

Le pipeline **gère déjà** les flux RSS/Atom/RDF : si la réponse est du XML, les liens sont extraits depuis `<item>` / `<entry>`.

- **Ajouter une source RSS** : dans l’UI Veille, coller l’**URL du flux** (ex. `https://www.nature.com/nchem.rss`, `http://feeds.rsc.org/rss/sc`) comme URL de la source. Même table, même CRUD.
- **Recommandation** : pour les sites à page JS (ex. Nature search → 0 lien en fetch), **remplacer l’URL par le flux RSS** du même site.

### Stratégie par source : `fetch_strategy`

| Valeur   | Comportement |
|----------|--------------|
| **`auto`** (défaut) | Fetch HTTP. Si la réponse ressemble à une page anti-bot (0 URL, titre « Client Challenge »…), un message est logué pour suggérer une URL de flux RSS. |
| **`fetch`** | Toujours fetch HTTP. |
| **`rss`**   | Même fetch ; l’URL doit pointer vers un flux RSS/Atom. Détection XML automatique. |

La détection XML vs HTML se fait **après** réception du contenu.

### Détection anti-bot

Si on reçoit du HTML avec **0 URL** et des indicateurs type « Client Challenge », « Just a moment », on log une suggestion : **remplacer l’URL par un flux RSS** si disponible.

### Tester `fetch_strategy`

- **API** : `PATCH /api/veille/sources/:id` avec `{ "fetch_strategy": "rss" }` (ou `"fetch"`, `"auto"`).
- **Base** : `UPDATE sources SET fetch_strategy = 'rss' WHERE id = '...';`

---

## 4. Structure du code (lib/veille)

| Fichier | Responsabilité |
|---------|----------------|
| **sources.ts** | CRUD sources depuis Supabase. |
| **fetch-source-pages.ts** | Récupérer HTML/XML des pages sources (fetch HTTP uniquement). |
| **extract-urls.ts** | RSS/Atom/RDF → parse XML ; HTML → parse cheerio → URLs depuis `<a href>`. |
| **detect-bot-challenge.ts** | Détection page anti-bot (0 URL, titre type « Client Challenge ») → log suggestion RSS. |
| **guardrails.ts** | Dédup URL (getExistingArticleUrls), dédup DOI, pré-filtre assets/CDN, quotas. |
| **filter-urls-llm.ts** | LLM : liste d’URLs → uniquement les URLs à garder. Échec → run failed. |
| **clean-article-html.ts** | Pré-nettoyage du bloc article (cheerio). |
| **extract-article-llm.ts** | Pour chaque URL : fetch → clean → LLM (titre, auteurs, DOI, abstract, date). Skip + last_error si erreur. |
| **filter-article-display.ts** | Filtre d’affichage (titre/abstract/DOI, exclusion titres institutionnels). |
| **score.ts** | Heuristique + similarité (embedding abstract vs DB). |
| **run-pipeline.ts** | Orchestration de la run (étapes 1→10). |

---

## 5. Garde-fous

| Garde-fou | Rôle |
|-----------|------|
| **Dédup URL (veille_items)** | Avant le LLM « détection d’articles » : retirer les URLs déjà en base. Évite re-scrape et envoi inutile au LLM. |
| **Dédup DOI** | À l’insert : ne pas insérer si le DOI est déjà dans `veille_items` ou `documents`. |
| **Pré-filtrage URLs** | Exclure assets, CDN, analytics pour réduire le volume envoyé au LLM. |
| **Rate limit / quotas** | Une run à la fois ; quotas après filtre LLM (ex. 30/run, 10/source). |
| **Échec LLM (filtrage URLs)** | Si l’appel LLM « quelles URLs sont des articles ? » échoue → **run failed** (pas de fallback heuristique). |
| **Skip + log (item)** | Erreur sur une URL (timeout, 403, LLM) → skip, `last_error` sur l’item, continuer les autres. |
| **Insertion** | Ne pas insérer si ni titre ni DOI (skip + log). |

---

## 6. Décisions validées

| Sujet | Décision |
|-------|----------|
| **Extraction URLs** | Flux RSS/Atom/RDF → parse XML ; HTML → parse (cheerio) depuis `<a>`. Fetch HTTP uniquement (pas de navigateur). |
| **Plafond URLs vers LLM** | Aucun plafond sur la liste envoyée au LLM (déjà pré-filtrée et sans URLs déjà en base). Quotas **après** le filtre LLM. |
| **Sortie LLM « détection articles »** | Uniquement la liste des URLs à garder (pas de paires URL / oui-non). |
| **Extraction article** | Pré-nettoyage obligatoire du bloc article puis LLM sur l’extrait (titre, auteurs, DOI, abstract, date). |
| **Échec LLM filtre URLs** | Run en statut **failed** ; pas de fallback heuristique. |
| **Déclenchement** | UI (bouton manuel). Run = toutes les sources d’un coup. |
| **Erreurs item** | Skip + log dans `last_error`. |
| **Scores** | Heuristique → `heuristic_score` ; vectoriel → `similarity_score` ; tri par score (ex. similarity desc). |
| **Affichage** | filterItemsForArticleDisplay() : garde items avec titre/abstract/DOI, exclut titres institutionnels. |

---

## 7. Limites et tensions connues

- **Pages JS-only** (ex. Nature search) : fetch HTTP renvoie 0 lien. **Solution** : utiliser l’URL du flux RSS du site.
- **Une seule URL « article » évidente par page** (ex. RSC journal issues) : l’heuristique ne garde qu’un article ; le reste passe par le LLM, qui peut laisser du bruit (librarian, historical collection). **Mitigation** : post-filtre par chemin + filtre d’affichage.
- **Bruit LLM** : le LLM peut renvoyer des URLs non-article. Stratégie actuelle : heuristique + LLM + post-filtre + filtre d’affichage ; priorité rappel (accepter un peu de bruit).
- **Coût / latence** : un appel LLM pour le filtre URLs + un par URL retenue ; quotas limitent le volume.

---

## 8. Comment tester

### Prérequis

- `.env.local` : Supabase, `OPENAI_API_KEY`.
- Tables Supabase : `sources`, `veille_runs`, `veille_items`.

### Étapes (UI)

1. `npm run dev` → http://localhost:3000
2. Menu **Veille** → `/veille`
3. **Ajouter une source** : ex. `https://pubs.rsc.org/en/journals/journalissues/sc#` (HTML) ou `https://www.nature.com/nchem.rss` (RSS). Pour Nature search (page JS), utiliser un flux RSS.
4. **Lancer la pipeline** → run en arrière-plan (statut running → completed/failed).
5. Consulter le **tableau** (titre, source, scores) et les **runs**. Tri par score ; seuls les items avec titre ou DOI sont insérés.

### Logs utiles

- `[veille/run-pipeline]` : nombre d’URLs par source, après préfiltre, après LLM, items traités.
- `[veille/filter-urls-llm] heuristic keep` : URLs gardées sans LLM.
- `runVeillePipeline item skip (no title nor DOI)` : URL traitée mais non insérée.

### API (sans UI)

```bash
# Lancer une run
curl -X POST http://localhost:3000/api/veille/scrape -H "Content-Type: application/json" -d '{"wait":false}'
# → { "runId": "..." }

# Statut (remplacer RUN_ID)
curl http://localhost:3000/api/veille/runs/RUN_ID

# Liste des items
curl "http://localhost:3000/api/veille/items?limit=100"
```

---

## 9. Références

| Document | Contenu |
|----------|---------|
| **VUE_ENSEMBLE_PROJET.md** | Besoins, flows d’usage, structure. |
| **FONCTIONNALITES_FRONT.md** | Liste rankée, bouton pipeline, tableau veille. |
| **SCHEMA_DB_ET_DONNEES.md** | Tables `sources`, `veille_runs`, `veille_items`, colonne `fetch_strategy`. |
| **STRUCTURE_ET_ARCHITECTURE.md** | Dossiers `lib/veille`, `app/api/veille/`. |
