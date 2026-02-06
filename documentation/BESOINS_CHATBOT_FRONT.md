# Besoins chatbot RAG — Front et Back

**Objectif** : document de besoins pour le chatbot complet (historique des conversations, contexte multi-tours, garde-fou hors domaine, streaming, paramètres admin). Ce document sert de référence pour le front (UI) et pour les impacts back (tables, API, logique).

---

## 1. Périmètre et utilisateurs

| Élément | Décision |
|--------|----------|
| **Utilisateurs** | Un seul utilisateur (pas de multi-tenant ; pas de partage entre utilisateurs). |
| **Accès** | Projet déployé sur internet (Next.js hébergé) ; pas de serveur local 24/7. |
| **Authentification** | Utilisateur connecté (Supabase Auth) ; historique lié à la session. À terme un seul user, mais la structure (user_id sur conversations) reste cohérente pour évolutions. |

---

## 2. Historique des conversations

### 2.1 Comportement

- **Persistance** : les conversations sont **stockées en base** (tables `conversations` + `messages`).
- **Retour utilisateur** : quand l’utilisateur revient (ex. le lendemain), il voit la **liste de ses conversations** (sidebar) et peut rouvrir une conversation existante.
- **Durée de vie** : **30 jours**. Les conversations (et leurs messages) plus anciennes peuvent être supprimées automatiquement (cron / job) ou manuellement ; à configurer côté back (voir SCHEMA_SUPABASE.md).

### 2.2 Granularité (back)

- **Conversation** : une entrée par fil de discussion.
  - Champs : `id`, `title`, `created_at`, `updated_at`, optionnellement `user_id`.
  - Titre : **généré côté back** à la création (ex. via API OpenAI à partir du premier message, ou troncature du premier message). **Modifiable à la main** par l’utilisateur (champ éditable dans l’UI, PATCH en back).
- **Messages** : un enregistrement par message (user ou assistant).
  - Champs : `id`, `conversation_id`, `role` ('user' | 'assistant'), `content`, `sources` (jsonb, optionnel — pour les réponses assistant avec citations), `created_at`.
  - Stockage **message par message** pour permettre scroll infini, reprise de contexte (N derniers messages), et éventuel export / audit.

### 2.3 Front — Liste des conversations (sidebar)

- **Affichage** : **sidebar** avec liste des conversations.
- **Colonnes (ou lignes)** : **titre** + **date** (création ou dernière activité).
- **Ordre** : par défaut **date décroissante** (plus récent en haut).
- **Actions** : clic pour ouvrir la conversation ; optionnel : suppression, renommage (titre éditable).
- **Nouvelle conversation** : bouton explicite « Nouvelle conversation » qui repart à zéro (sans contexte d’une conversation précédente).

---

## 3. Contexte pour le LLM (historique des réponses précédentes)

### 3.1 Nombre de tours en arrière

- **Valeur par défaut** : les **3 derniers échanges** (paires user + assistant) sont envoyés au LLM en plus du contexte RAG (chunks) et de la nouvelle question.
- **Paramétrable** : ce nombre (ex. 3) est **configurable** depuis un **panneau admin** (ex. « Nombre de tours de contexte » : 1 à 10). Stockage : variable d’environnement, table `settings`, ou fichier config selon l’implémentation ; recommandation : table ou config côté serveur lue par l’API.

### 3.2 Récapitulatif (synthèse) des N derniers messages

- **Besoin exprimé** : possibilité de **synthétiser / récapituler** les 3 derniers messages avant d’envoyer au LLM (pour réduire la taille du contexte et clarifier).
- **Impact** : cela nécessite un **appel supplémentaire à une IA en cloud** (ex. OpenAI) pour produire un résumé du fil récent. Coût et latence en plus.
- **Décision documentée** : en **V1**, on envoie les **N derniers messages bruts** (user + assistant) dans le prompt, sans étape de synthèse. L’option « récap par une IA » est notée comme **évolution possible** (voir CHATBOT_GENERATION_ET_GARDE_FOU.md).

### 3.3 Chunks / sources à chaque message

- À **chaque nouveau message** utilisateur : on refait une **recherche vectorielle** sur la **dernière question** uniquement (pas de ré-embedding de tout l’historique). Les chunks récupérés + les N derniers messages + la nouvelle question sont envoyés au LLM.

---

## 4. Garde-fou « hors domaine »

### 4.1 Objectif

Éviter que le chatbot réponde à des questions **hors du domaine** (recherche fondamentale / corpus scientifique), par ex. « Comment faire mes courses le vendredi ? » ou « Quelle musique à Woodstock ? ». Dans ce cas, on affiche un message du type : **« Requête trop éloignée de la recherche fondamentale. »** (ou variante paramétrable).

### 4.2 Déclenchement (stratégie retenue)

- **Critère** : après la **recherche vectorielle**, on regarde la **similarité du meilleur chunk** (score du premier résultat).
  - Si **meilleure similarité < seuil** (ex. 0,5) → on considère la requête **hors domaine**.
- **Paramètres** (modifiables depuis le **panneau admin**) :
  - **Seuil de similarité** (ex. 0,5) : en dessous, pas d’appel LLM.
  - **Message utilisateur** (texte) : ex. « Requête trop éloignée de la recherche fondamentale. » — éditable.
- **Comportement** :
  - **Pas d’appel à l’API OpenAI** : on arrête **avant** l’appel LLM (économie de coût et latence).
  - La **recherche** (embedding + match_chunks) est tout de même exécutée pour pouvoir calculer la similarité ; dès que le résultat est connu, si sous le seuil → retour du message garde-fou sans appeler OpenAI.

### 4.3 Stockage

- Même en cas de **hors domaine** : le **message utilisateur** et la **réponse garde-fou** (message assistant avec le texte configuré) sont **enregistrés** dans l’historique (table `messages`), comme un échange normal. Ainsi la conversation reste cohérente et l’utilisateur peut voir qu’il a posé une question hors domaine.

---

## 5. Panneau admin / paramètres

- **Objectif** : pouvoir **modifier les paramètres** du chatbot sans toucher au code, pour observer les impacts (qualité, coût, UX).
- **Paramètres à exposer** (liste cible) :
  - **Nombre de tours de contexte** : 1 à 10 (défaut 3).
  - **Seuil de similarité (garde-fou)** : ex. 0,3 à 0,8 (défaut 0,5).
  - **Message hors domaine** : texte libre (ex. « Requête trop éloignée de la recherche fondamentale. »).
  - **Seuil / nombre de chunks** pour la recherche : ex. `match_count`, `match_threshold` (optionnel en admin).
- **Stockage** : table `settings` (clé / valeur ou colonnes dédiées) ou fichier config côté serveur ; à définir en implémentation. Les API RAG lisent ces paramètres avant chaque traitement.

---

## 6. Interface — Conversation et messages

### 6.1 À l’intérieur d’une conversation

- **Affichage des messages** : **scroll infini** (chargement par page, ex. 20 messages par requête).
- **Réponses assistant** : affichage des **citations** [1], [2]… comme prévu dans RAG_REFERENCE.md.
- **Sources** : pour chaque citation ou bloc de sources, **point « i » (info)** au survol ou au clic : afficher les infos du document (titre, DOI, section, page, chemin si pertinent).

### 6.2 Streaming de la réponse

- **Exigence** : la **réponse du chatbot doit s’afficher en streaming** (texte qui apparaît au fur et à mesure) depuis l’interface.
- **Implémentation back** : l’API de chat (ex. `POST /api/rag/chat`) doit renvoyer un **flux** (Server-Sent Events ou ReadableStream) plutôt qu’un JSON unique. Côté OpenAI : utilisation de `stream: true` dans Chat Completions, puis retransmission des chunks au client.
- **Implémentation front** : consommation du stream (fetch + ReadableStream ou EventSource) et mise à jour progressive du DOM (ou state) pour afficher le texte au fil de l’eau. Une fois le stream terminé, on peut persister le message assistant complet en base (côté back ou via un second appel).

---

## 7. Synthèse des impacts Back

| Besoin | Impact Back |
|--------|-------------|
| Historique conversations (liste + retour) | Tables `conversations` et `messages` ; API listant les conversations, récupération des messages par conversation (pagination). |
| Titre conversation (généré + éditable) | Génération du titre à la création (optionnel : appel OpenAI) ; PATCH sur `conversations.title`. |
| Contexte N derniers messages | Lors de POST chat : chargement des derniers messages de la conversation, envoi des N derniers au LLM. Paramètre N lisible depuis config/admin. |
| Garde-fou hors domaine | Après recherche vectorielle : si `best_similarity < seuil` → retour message configuré, pas d’appel OpenAI ; enregistrement message user + assistant (garde-fou) en base. Paramètres (seuil, message) lisibles depuis config/admin. |
| 30 jours rétention | Job/cron ou fonction planifiée supprimant les conversations (et messages) dont `updated_at` ou `created_at` > 30 jours ; ou doc pour exécution manuelle. |
| Streaming | API chat en stream (SSE ou ReadableStream) ; sauvegarde du message assistant complète à la fin du stream. |
| Admin paramètres | Table ou config pour seuil, message hors domaine, nombre de tours de contexte ; API ou page protégée pour les modifier. |

---

## 8. Synthèse des impacts Front

| Besoin | Impact Front |
|--------|--------------|
| Sidebar conversations | Liste (titre + date), clic pour ouvrir, bouton « Nouvelle conversation ». |
| Scroll infini messages | Pagination (cursor ou offset) lors du chargement des messages d’une conversation. |
| Citations + point « i » | Affichage [1], [2]… et tooltip/modal avec infos document au survol/clic. |
| Streaming | Affichage progressif du texte de la réponse (état local mis à jour à chaque chunk reçu). |
| Titre éditable | Champ titre éditable (input ou inline) ; envoi PATCH pour sauvegarder. |
| Panneau admin | Page ou section (protégée) pour modifier : nombre de tours, seuil similarité, message hors domaine. |

---

## 9. Références

| Document | Contenu |
|----------|---------|
| **SCHEMA_SUPABASE.md** | Tables `conversations`, `messages`, rétention 30 jours, liste des migrations. |
| **RAG_REFERENCE.md** | Pipeline RAG, chatbot, streaming, garde-fou, contexte. |
| **CHATBOT_GENERATION_ET_GARDE_FOU.md** | Méthodologie détaillée : génération avec historique, garde-fou, paramètres, option récap. |
