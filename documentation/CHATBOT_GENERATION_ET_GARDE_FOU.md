# Chatbot RAG — Génération, contexte et garde-fou

**Objectif** : méthodologie détaillée pour la génération des réponses (contexte multi-tours, garde-fou hors domaine, streaming, paramètres). Complète RAG_REFERENCE.md et BESOINS_CHATBOT_FRONT.md.

---

## 1. Flux global (un message utilisateur)

```
[Message utilisateur] (+ conversationId pour reprendre une conversation)
        ↓
 Charger les N derniers messages de la conversation (si conversationId)
        ↓
 Embedding de la requête (même modèle 384D)
        ↓
 Recherche vectorielle (match_chunks) → chunks + best_similarity
        ↓
 Si best_similarity < seuil_garde_fou
   → Réponse = message_hors_domaine (config)
   → Pas d’appel OpenAI
   → Enregistrer message user + message assistant (garde-fou) en base
        ↓
 Sinon :
   → Construire le prompt : system + (N derniers messages) + contexte (chunks) + nouvelle question
   → Appel OpenAI Chat Completions en stream
   → Streamer la réponse vers le client
   → À la fin du stream : enregistrer message user + message assistant (contenu complet + sources) en base
```

---

## 2. Contexte envoyé au LLM

### 2.1 Contenu du prompt

- **Message système** : instruction fixe (s’appuyer uniquement sur le contexte, citer [1], [2]…).
- **Historique** : les **N derniers échanges** (user puis assistant) de la conversation, si présents. N = paramètre admin (défaut 3).
- **Contexte RAG** : les **chunks** retournés par la recherche vectorielle pour la **dernière question** uniquement (pas de ré-embedding de l’historique).
- **Nouvelle question** : le message utilisateur courant.

### 2.2 Option « récapitulatif » (évolution)

- **Besoin** : synthétiser les N derniers messages avant de les envoyer au LLM (pour réduire la taille du contexte et clarifier).
- **Méthode** : un **appel préalable** à l’API OpenAI (ou autre IA cloud) avec les N derniers messages en entrée, pour produire un court résumé.
- **Statut** : **non implémenté en V1**. En V1 on envoie les N derniers messages **bruts**. L’option récap est documentée ici pour évolution ultérieure (coût et latence en plus).

---

## 3. Garde-fou « hors domaine »

### 3.1 Règle

- **Après** la recherche vectorielle (`match_chunks`), on lit la **similarité du meilleur chunk** (premier résultat).
- Si **similarité < seuil** (ex. 0,5) → on considère que la requête est **hors du domaine** (recherche fondamentale / corpus).

### 3.2 Comportement

- **Pas d’appel à OpenAI** : on ne déclenche pas Chat Completions. On renvoie immédiatement le **message configuré** (ex. « Requête trop éloignée de la recherche fondamentale. »).
- **Stockage** : on enregistre quand même le **message utilisateur** et un **message assistant** dont le contenu est ce texte garde-fou. Ainsi l’historique reste cohérent.
- **Streaming** : pour ce cas, on peut renvoyer le message en une fois (pas de stream nécessaire) ou en « faux stream » (un seul chunk) pour garder la même UX côté front.

### 3.3 Paramètres (admin)

| Paramètre | Description | Défaut / exemple |
|-----------|-------------|------------------|
| **Seuil de similarité** | En dessous, déclenchement du garde-fou. | 0,5 |
| **Message hors domaine** | Texte affiché à l’utilisateur. | « Requête trop éloignée de la recherche fondamentale. » |

---

## 4. Streaming

### 4.1 Exigence

- La réponse du chatbot doit **s’afficher en streaming** dans l’interface (texte au fur et à mesure).

### 4.2 Côté back

- Appel OpenAI avec **`stream: true`** dans Chat Completions.
- L’API de chat (ex. `POST /api/rag/chat`) renvoie un **ReadableStream** (ou Server-Sent Events) : à chaque chunk reçu d’OpenAI, on le retransmet au client.
- **À la fin du stream** : une fois la réponse complète reçue, on enregistre le **message assistant** en base (contenu complet + `sources` en jsonb).

### 4.3 Côté front

- Consommation du stream (fetch + `response.body.getReader()` ou EventSource).
- Mise à jour progressive de l’état (ou du DOM) pour afficher le texte au fur et à mesure.
- Quand le stream est terminé : optionnellement mettre à jour la liste des messages côté client avec le message assistant final (ou le récupérer via un second appel si l’API le renvoie en fin de stream).

---

## 5. Titre de conversation

- **Génération** : à la **création** d’une nouvelle conversation (premier message), le titre peut être :
  - **Option A** : troncature du premier message utilisateur (ex. 50 caractères).
  - **Option B** : appel à l’API OpenAI pour générer un court titre à partir du premier message (coût et latence en plus).
- **Édition** : le titre est **modifiable à la main** par l’utilisateur (PATCH sur `conversations.title`). Pas d’impact majeur back : un champ `title` éditable suffit.

---

## 6. Paramètres admin (résumé)

| Paramètre | Usage | Où modifier |
|-----------|--------|--------------|
| **Nombre de tours de contexte** | N derniers échanges (user+assistant) envoyés au LLM. | Admin ou config serveur (défaut 3). |
| **Seuil similarité (garde-fou)** | En dessous → message hors domaine, pas d’appel LLM. | Admin ou config (défaut 0,5). |
| **Message hors domaine** | Texte affiché quand requête hors domaine. | Admin ou config. |
| **match_count / match_threshold** | Recherche vectorielle (nombre de chunks, seuil minimal). | Admin ou config (optionnel). |

Stockage recommandé : table `settings` (clé/valeur) ou fichier config côté serveur, lu par les API RAG au moment du traitement.

---

## 7. Références

| Document | Contenu |
|----------|---------|
| **BESOINS_CHATBOT_FRONT.md** | Besoins front et back, sidebar, scroll, streaming, admin. |
| **RAG_REFERENCE.md** | Pipeline RAG, recherche, génération, citations. |
| **SCHEMA_SUPABASE.md** | Tables `conversations`, `messages`, rétention. |
