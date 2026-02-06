# Spécification évolutions RAG — recherche hybride, APIs, admin, rétention

**Objectif** : document de spécification pour les évolutions à implémenter (recherche hybride, API conversations/messages, PATCH/DELETE, rétention 30 jours, panneau admin). Basé sur les réponses aux questions de conception.

---

## 1. Recherche hybride (FTS + fusion RRF)

### 1.1 Priorité

- **Recherche hybride** : à implémenter en priorité (avant ou en parallèle des autres évolutions).

### 1.2 Composants

- **FTS (lexical)** : requête sur `chunks.content_tsv` (tsvector) avec `plainto_tsquery` ou `websearch_to_tsquery`. Retourner les chunks avec un score de rang (ex. `ts_rank_cd`).
- **Vector (sémantique)** : existant — RPC `match_chunks` (similarité cosinus 384D).
- **Fusion RRF** : Reciprocal Rank Fusion des deux listes (par `chunk.id`). Formule RRF : `score = sum(1 / (k + rank))` avec `k` paramétrable (ex. 60). Trier par score RRF décroissant, prendre le top-K.

### 1.3 Paramètres (dans `rag_settings` ou extension)

| Clé | Description | Impact | Défaut / exemple |
|-----|-------------|--------|-------------------|
| **fts_weight** | Poids du rang FTS dans la fusion (0 = désactiver FTS, 1 = même poids que vector). | Plus élevé = les résultats purement lexicaux remontent plus. | 1 |
| **vector_weight** | Poids du rang vectoriel dans la fusion. | Plus élevé = les résultats sémantiques remontent plus. | 1 |
| **rrf_k** | Paramètre k de la formule RRF (dénominateur). | Plus k est grand, plus l’écart entre rangs est lissé. | 60 |
| **hybrid_top_k** | Nombre de chunks retournés après fusion RRF. | Chunks effectivement envoyés au LLM (et pour le garde-fou on regarde le premier). | 20 |

Tous ces paramètres sont **paramétrables** depuis le panneau admin ; chaque clé aura une **description** visible dans l’UI (impact sur le code / comportement).

### 1.4 Langue : recherche en français alors que la donnée est en anglais

- **Constat** : le corpus est en **anglais** ; `content_tsv` est en config **english**. Les requêtes peuvent être en **français**.
- **Options documentées** :
  1. **Ne pas dupliquer la base** : pas de peuplement en français ; on garde FTS en anglais.
  2. **FTS en anglais uniquement** : pour une requête en français, la partie FTS peut peu ou pas matcher (ex. "méthodes" vs "methods"). La partie **vectorielle** continue de matcher sémantiquement (embedding multilingue ou proche).
  3. **Traduction de la requête** (évolution optionnelle) : avant FTS, traduire la requête FR → EN (API ou modèle léger), puis exécuter FTS sur la requête traduite. À documenter comme évolution possible, pas obligatoire en V1.
- **Recommandation V1** : garder FTS sur le contenu anglais ; accepter que pour les requêtes en français, FTS contribue peu ; la fusion RRF favorisera les résultats vectoriels. Si besoin ultérieur : ajouter une étape de traduction de la requête vers l’anglais pour la branche FTS uniquement.
- **Peuplement FR+EN** : pas requis pour la V1 ; on ne double pas le contenu en base.

---

## 2. API liste des conversations et API messages (pagination)

### 2.1 GET liste des conversations

- **Route** : `GET /api/rag/conversations`.
- **Réponse** : tableau d’objets `{ id, title, created_at, updated_at }`. **Pas d’aperçu** (pas de premier message ni extrait) dans cette liste.
- **Ordre** : `updated_at` décroissant (plus récent en haut).
- **Pagination** : optionnelle (ex. `?limit=50`). Si pas de pagination, retourner les N dernières (ex. 50).

### 2.2 GET messages d’une conversation

- **Route** : `GET /api/rag/conversations/[id]/messages`.
- **Query** : pagination **cursor-based** (ex. `?cursor=message_id&limit=20`). Curseur = `id` du dernier message renvoyé (ou premier selon le sens). Pas d’offset simple.
- **Ordre** : **created_at croissant** (plus ancien en premier). Ainsi, en scrollant **vers le bas**, on charge les messages **plus récents** (comportement type chat).
- **Réponse** : tableau d’objets `{ id, role, content, sources?, created_at }`. Pour l’assistant, `sources` (jsonb) est présent si disponible.
- **Champs** : pas d’aperçu supplémentaire ; à l’intérieur de la conversation, l’aperçu est le contenu du message lui-même.

### 2.3 Choix technique pagination

- **Cursor-based** : recommandé pour le scroll infini (évite les décalages quand de nouveaux messages arrivent). Curseur = `id` du dernier message de la page précédente ; requête suivante : `where conversation_id = X and created_at > (select created_at from messages where id = cursor) order by created_at asc limit N`.

---

## 3. PATCH titre conversation / DELETE conversation

### 3.1 PATCH titre

- **Route** : `PATCH /api/rag/conversations/[id]`.
- **Body** : `{ "title": "Nouveau titre" }`.
- **Comportement** : **renommage manuel uniquement** (pas de "régénérer le titre" par API pour l’instant). Mise à jour de `conversations.title` et éventuellement `updated_at`.

### 3.2 DELETE conversation

- **Route** : `DELETE /api/rag/conversations/[id]`.
- **Comportement** : suppression **définitive** (DELETE en base). Les messages sont supprimés en cascade (FK).
- **Côté front** : **modal de confirmation** avant suppression (ex. "Supprimer cette conversation ?"). Après suppression réussie : redirection vers la **liste des conversations** (ou ouverture d’une nouvelle conversation vide, au choix implémentation).

---

## 4. Rétention 30 jours

### 4.1 Règle

- Supprimer les conversations (et leurs messages en cascade) pour lesquelles **updated_at < now() - 30 days** (pas d’activité depuis 30 jours). On s’appuie sur **updated_at**, pas sur **created_at**.
- **Pas de notification** utilisateur lors de la suppression.

### 4.2 Déclenchement (option gratuite)

- **Objectif** : documenter une solution **gratuite** pour exécuter le nettoyage périodiquement.
- **Options** :
  1. **Vercel Cron** (si déploiement sur Vercel) : une route dédiée (ex. `GET /api/cron/retention`) appelée par Vercel Cron (planification dans `vercel.json`). La route vérifie une clé secrète (env) pour éviter les appels non autorisés, puis exécute la suppression en SQL (via Supabase client).
  2. **Script manuel** : script Node ou SQL exécutable à la main (ou via un cron local/serveur). Documenter la requête SQL ou l’appel API.
  3. **Supabase Edge Function + pg_cron** : si disponible sur le projet (selon offre Supabase), une fonction planifiée peut exécuter la suppression. À documenter si pertinent.
- **Recommandation** : documenter en priorité **Vercel Cron + route API** (gratuit sur Vercel) ou **script SQL/manuel** pour ne pas dépendre d’un service payant.

---

## 5. Panneau admin — paramètres `rag_settings`

### 5.1 Accès

- **Pas de protection** supplémentaire : l’admin est accessible **directement depuis l’interface** (même utilisateur que le reste). Un seul utilisateur ; pas de rôle admin séparé pour l’instant.

### 5.2 Paramètres exposés

- **Tous** les paramètres présents dans `rag_settings` sont modifiables depuis l’admin :
  - **context_turns** — nombre de tours de contexte (user+assistant) envoyés au LLM.
  - **similarity_threshold** — seuil de similarité pour le garde-fou hors domaine (en dessous : pas d’appel LLM).
  - **guard_message** — message affiché lorsque la requête est jugée hors domaine.
  - **match_count** — nombre max de chunks retournés par la recherche vectorielle (avant fusion si hybride).
  - **match_threshold** — seuil minimal de similarité pour qu’un chunk soit inclus dans les résultats vectoriels (RPC `match_chunks`).
  - **fts_weight**, **vector_weight**, **rrf_k**, **hybrid_top_k** (dès que la recherche hybride et ces clés sont en place).

### 5.3 Description par paramètre (impact sur le code)

- Chaque paramètre doit avoir une **description courte** visible dans l’UI admin, expliquant **l’impact sur le comportement** (ex. "Augmenter augmente le contexte envoyé au LLM et peut améliorer la cohérence, au prix de plus de tokens.").
- Les descriptions seront soit stockées (ex. table ou JSON dédié), soit codées en dur dans le front (liste clé → description). **Accessible** = affichée à côté du champ dans le panneau admin.

### 5.4 Validation

- **Bornes recommandées** (à implémenter côté API ou front) :
  - **context_turns** : 1–10.
  - **similarity_threshold** : 0.1–0.9 (float).
  - **match_count** : 5–100 (entier).
  - **match_threshold** : 0.0–1.0 (float).
  - **fts_weight**, **vector_weight** : ≥ 0 (float).
  - **rrf_k** : entier > 0 (ex. 1–200).
  - **hybrid_top_k** : 5–100 (entier).
- En cas de valeur hors bornes : retour d’erreur (API) ou message dans l’UI, sans modifier la valeur en base.

---

## 6. Ordre de mise en œuvre suggéré

1. **Recherche hybride** : FTS + RRF, paramètres (poids, rrf_k, hybrid_top_k), ajout des clés dans `rag_settings` si besoin.
2. **API conversations** : GET liste ; GET messages avec pagination cursor-based.
3. **PATCH / DELETE conversation** : routes + modal confirmation côté front.
4. **Sidebar + scroll infini + streaming** (front) : liste conversations, chargement des messages, affichage streaming (déjà en place côté API).
5. **Panneau admin** : lecture/écriture de tous les paramètres `rag_settings`, avec descriptions et validation.
6. **Rétention 30 jours** : route cron (ou script) + doc (Vercel Cron ou script manuel).

---

## 7. Références

| Document | Contenu |
|----------|---------|
| **AUDIT_BESOINS_RAG.md** | État actuel (fait / manquant). |
| **BESOINS_CHATBOT_FRONT.md** | Besoins détaillés chatbot. |
| **RAG_REFERENCE.md** | Pipeline RAG, FTS + vector + RRF. |
| **SCHEMA_SUPABASE.md** | Tables `conversations`, `messages`, `rag_settings`, `chunks.content_tsv`. |
