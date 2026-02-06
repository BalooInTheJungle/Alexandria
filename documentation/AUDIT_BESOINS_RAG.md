# Audit besoins RAG — Front et Back

**Date** : synthèse de l’état actuel par rapport aux besoins (BESOINS_CHATBOT_FRONT.md, RAG_REFERENCE.md).

---

## 1. Garde-fou

| Besoin | Statut | Détail |
|--------|--------|--------|
| **Hors domaine** | ✅ En place | Après recherche vectorielle : si `best_similarity < similarity_threshold` → message configuré (pas d’appel OpenAI), échange enregistré en base. |
| **Paramètres** | ✅ En place | `rag_settings.similarity_threshold`, `rag_settings.guard_message` ; lus par l’API à chaque requête. |
| **Panneau admin** | ❌ Manquant | Pas encore de page/API pour modifier ces paramètres depuis l’UI (modification possible en SQL sur `rag_settings`). |

**Conclusion** : le garde-fou « hors domaine » est bien en place. Il manque uniquement l’UI admin pour modifier seuil et message sans toucher à la base.

---

## 2. Recherche hybride (sémantique + lexicale)

| Besoin (RAG_REFERENCE §4) | Statut | Détail |
|---------------------------|--------|--------|
| **FTS (lexical)** | ❌ Non utilisé | La table `chunks` a `content_tsv` (tsvector) + index GIN + trigger, mais **aucune requête FTS** dans le flux de recherche. |
| **Vector (sémantique)** | ✅ En place | RPC `match_chunks` : similarité cosinus sur `embedding` (384D). |
| **Fusion RRF** | ❌ Manquant | Pas de fusion entre résultats FTS et vectoriels ; pas de RRF. |

**Conclusion** : la recherche est **uniquement vectorielle (sémantique)**. La partie **lexicale (FTS)** et la **fusion hybride (ex. RRF)** ne sont pas implémentées. Pour une recherche vraiment hybride, il faut : (1) requête FTS sur `content_tsv`, (2) fusion RRF des résultats FTS + vector, (3) retour du top-K fusionné.

---

## 3. Back — fait / manquant

### Fait

- Tables : `conversations`, `messages`, `rag_settings` ; RPC `match_chunks`.
- API `POST /api/rag/chat` : query, conversationId, stream ; garde-fou ; historique N messages ; persistance ; streaming (SSE).
- Lecture `rag_settings` (context_turns, similarity_threshold, guard_message, match_count, match_threshold).
- Persistance : getOrCreateConversation, insertMessage, getLastMessages.

### Manquant

- **Recherche hybride** : FTS + fusion RRF (voir §2).
- **API conversations** : `GET /api/rag/conversations` (liste pour sidebar).
- **API messages** : `GET /api/rag/conversations/[id]/messages` (pagination pour scroll infini).
- **PATCH conversation** : mise à jour du titre (éditable).
- **DELETE conversation** : suppression (optionnel).
- **Rétention 30 jours** : job/cron ou script pour supprimer les conversations (et messages) dont `updated_at` &lt; now() - 30 days.
- **Panneau admin** : API ou page pour lire/écrire `rag_settings` (sans SQL).
- **Titre conversation** : génération par API (optionnel ; actuellement troncature du premier message).

---

## 4. Front — fait / manquant

### Fait

- Authentification : formulaire login (email/mot de passe), cookies gérés par Supabase.
- Page RAG : champ de texte + envoi à `POST /api/rag/chat` (stream: false), affichage réponse + sources + conversationId.
- Pas de curl nécessaire : tout se fait depuis l’UI.

### Manquant

- **Sidebar conversations** : liste (titre + date), clic pour ouvrir, bouton « Nouvelle conversation ».
- **Scroll infini** des messages dans une conversation (pagination).
- **Streaming** : affichage progressif de la réponse (activer `stream: true` côté client et consommer le SSE).
- **Citations** : affichage [1], [2]… avec **point « i »** (tooltip/modal : titre, DOI, section, page).
- **Titre conversation** éditable (input + PATCH).
- **Panneau admin** : page pour modifier paramètres RAG (context_turns, similarity_threshold, guard_message, etc.).

---

## 5. Synthèse

| Thème | État |
|-------|------|
| **Garde-fou hors domaine** | ✅ Implémenté (seuil + message ; réglable en base, pas encore en UI admin). |
| **Recherche hybride (FTS + vector + RRF)** | ❌ Non : uniquement vector. FTS et fusion à ajouter. |
| **Back (chat, historique, persistance, stream)** | ✅ En place. Manquent : API list conversations/messages, PATCH/DELETE conversation, rétention 30 j, admin. |
| **Front (chat minimal)** | ✅ En place. Manquent : sidebar, scroll infini, streaming affiché, citations + point « i », titre éditable, admin. |

---

## 6. Références

- **BESOINS_CHATBOT_FRONT.md** — besoins détaillés.
- **RAG_REFERENCE.md** — §4 recherche hybride (FTS + vector + RRF).
- **SCHEMA_SUPABASE.md** — tables, `content_tsv`, `match_chunks`.
