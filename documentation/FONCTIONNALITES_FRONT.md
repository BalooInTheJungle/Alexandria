# Fonctionnalités Front — RAG + Veille

**Rôle** : référence des **fonctionnalités côté interface** (RAG et Veille), avec les subtilités : **langue** (FR/EN), **recherche** (hybride, garde-fou), **citations**, **streaming**, **admin**. Ce qui est en place et ce qui reste à faire.

---

## 1. Vue d’ensemble

- **Périmètre** : **un seul utilisateur** (pas de multi-tenant ; pas de partage entre utilisateurs). Accès : projet déployé sur internet (Next.js hébergé) ; pas de serveur local 24/7. Historique des conversations lié à la session (Supabase Auth).  
- **Deux zones principales** : **RAG** (une page : chat sur le corpus) et **Bibliographie** (une page : veille rankée + documents / upload).  
- **Authentification** : login obligatoire (Supabase Auth) ; accès aux deux zones après connexion.  
- **Une seule interface** : même layout, nav commune (RAG | Bibliographie).  
- **Évolution possible** : proposer **deux modes** — (1) **Recherche** : requête → affichage des passages / chunks pertinents sans génération LLM ; (2) **Question (chatbot)** : même retrieval + LLM → réponse avec citations en streaming. En V1 seul le mode chatbot est implémenté.

---

## 2. RAG — Recherche et langue

### 2.1 Requête et langue

- **Un seul champ de saisie** : l’utilisateur tape sa question **en français ou en anglais** sans choisir la langue dans l’UI.
- **Détection côté back** : la langue est détectée **sur le texte de la requête** (avant toute recherche), via `lib/rag/detect-lang.ts` (heuristique FR/EN). Le front envoie simplement la requête ; il n’y a **pas de sélecteur de langue** à afficher.
- **Réponse dans la même langue** : le back renvoie une réponse **toujours dans la langue de la requête** (FR ou EN). L’utilisateur voit donc sa question et la réponse dans la même langue, sans action de sa part.
- **Sources (excerpts)** : les extraits affichés dans les citations sont **dans la même langue** que la réponse (contenu EN ou FR selon la détection). Les métadonnées (titre, DOI, section, page) restent celles du document.

### 2.2 Recherche (ce que voit l’utilisateur)

- L’utilisateur envoie **une requête** ; le back exécute la **recherche hybride** (FTS + vector + fusion RRF) sur le bon index (EN ou FR selon la langue détectée).
- **Aucun mode « recherche seule » vs « chat »** à choisir dans l’UI pour l’instant : chaque envoi = recherche + génération de réponse (sauf garde-fou).
- **Pas d’indication explicite** dans l’UI que la recherche est hybride ou bilingue ; le comportement est transparent.

### 2.3 Garde-fou « hors domaine »

- **Quand** : si la requête est jugée **trop éloignée** du corpus (similarité du meilleur chunk < seuil), le back **n’appelle pas** le LLM.
- **Ce que voit l’utilisateur** : un **message fixe** (ex. « Requête trop éloignée de la recherche fondamentale. »), identique à une réponse assistant mais **sans citations** [1], [2] et **sans liste de sources**. Le message peut être renvoyé en une fois (pas de streaming) ou en « faux stream » pour garder la même UX.
- **Stockage** : le message utilisateur et ce message garde-fou sont **enregistrés** en base comme un échange normal ; la conversation reste cohérente (l’utilisateur peut constater qu’il a posé une question hors domaine).
- **Paramétrage** : le **texte du message** et le **seuil** sont modifiables depuis le **panneau admin** (pas d’indication dans l’UI chat que c’est un « message garde-fou » ; pour l’utilisateur c’est une réponse comme une autre).

---

## 3. RAG — Conversation et affichage

### 3.1 Liste des conversations (sidebar) — en place

- **Affichage** : **sidebar** avec la liste des conversations : **titre** + **date** (dernière activité).
- **Ordre** : **date décroissante** (plus récent en haut). Appel à `GET /api/rag/conversations?limit=50`.
- **Actions** : clic pour ouvrir la conversation ; **Nouvelle conversation** (bouton) ; **Renommer** (inline, PATCH) ; **Supprimer** (modal de confirmation, DELETE).

### 3.2 Messages dans une conversation — en place

- **Affichage** : messages **user** et **assistant** dans l’ordre chronologique ; **scroll infini** (cursor, 20 par page) via `GET /api/rag/conversations/[id]/messages?cursor=...&limit=20`.
- **Réponses assistant** : affichage des **citations** [1], [2]… dans le texte (sous le champ de saisie pour la dernière réponse).
- **Sources** : pour chaque citation, infos document (titre, DOI, excerpt) ; évolution possible : point « i » au survol. Les **excerpts** sont dans la **même langue** que la réponse (FR ou EN).

### 3.3 Streaming de la réponse

- **Exigence** : la **réponse du chatbot s’affiche en streaming** (texte qui apparaît au fur et à mesure).
- **Implémentation front** : envoi de la requête avec `stream: true` ; consommation du flux SSE (fetch + `response.body.getReader()` ou EventSource) ; mise à jour progressive du DOM (ou state) à chaque chunk reçu. Quand le stream est terminé, l’événement `done` contient conversationId, messageId, sources ; optionnellement mettre à jour la liste des messages côté client avec le message assistant final (ou le récupérer via les données renvoyées en fin de stream).
- **Garde-fou** : dans ce cas pas de stream « token par token » ; le message garde-fou peut être affiché en une fois (ou en un seul chunk) pour garder la même forme de réponse côté UI.

### 3.4 Titre de conversation — en place

- **À la création** : le titre est généré côté back (troncature du premier message).
- **Édition** : bouton **Renommer** dans la sidebar ; sauvegarde via **PATCH /api/rag/conversations/[id]**.

---

## 4. RAG — Panneau admin — en place

- **Page** : **/rag/settings** (lien « Paramètres RAG » depuis la page RAG). Même utilisateur que le reste.
- **GET /api/rag/settings** : chargement des valeurs ; **PATCH /api/rag/settings** : enregistrement (validation des bornes côté back ; 400 sans modification en base en cas d’erreur).
- **Paramètres** : context_turns, similarity_threshold, guard_message, match_count, match_threshold, fts_weight, vector_weight, rrf_k, hybrid_top_k — chaque champ avec libellé et bornes (input number ou textarea pour guard_message).

---

## 5. Veille (Bibliographie)

### 5.1 Liste rankée

- **Contenu** : liste des **articles** récupérés par la veille : **titre**, **abstract**, **URL** de la page, **score de similarité** (vs corpus) si disponible.
- **Ordre** : par **score décroissant** (pertinence) ou par date selon implémentation.
- **Action** : l’utilisateur **clique sur l’URL** pour ouvrir la page de l’article sur le site source (pas de lecture dans l’app).
- **Déclenchement** : **bouton** (ex. « Lancer la veille ») pour démarrer une run ; la run peut durer longtemps → job asynchrone ; affichage du statut (running / completed / failed) si prévu.

### 5.2 À faire (front)

- Appel à `GET /api/veille/list` (ou équivalent) pour récupérer les items de la dernière run (ou liste paginée).
- Affichage des erreurs éventuelles (last_error sur un item) de façon lisible (ex. tooltip ou ligne dédiée).

---

## 6. Documents (section Bibliographie)

- **Upload** : dépôt d’un ou plusieurs PDFs (front → API upload) ; enregistrement en base (document) ; déclenchement de l’ingestion (à la main ou via API selon implémentation).
- **Liste** : affichage des documents indexés (titre, DOI, statut, date) avec possibilité d’ouvrir le PDF (via storage_path ou lien).
- **Emplacement** : dans la section **Bibliographie** (ex. onglet ou sous-page « Documents »), pas en page racine.

---

## 7. Synthèse : Fait / À faire (Front)

| Fonctionnalité | Fait | À faire |
|----------------|------|---------|
| **Auth** | Login (email/mot de passe), cookies Supabase. | — |
| **RAG — Champ requête** | Envoi à POST /api/rag/chat (stream: false), affichage réponse + sources + conversationId. | Activer stream: true et afficher la réponse en streaming. |
| **RAG — Langue** | — | Aucun : le back gère la détection ; la réponse et les excerpts arrivent dans la bonne langue. |
| **RAG — Garde-fou** | Le back renvoie guard_message ; le front l’affiche comme une réponse assistant (sans sources). | — |
| **Sidebar conversations** | — | Liste (titre + date), clic pour ouvrir, bouton Nouvelle conversation ; GET conversations. |
| **Messages / scroll infini** | — | GET messages (pagination cursor), affichage par page. |
| **Citations + point « i »** | — | Affichage [1], [2]… et tooltip/modal avec titre, DOI, section, page (excerpt dans la langue de la réponse). |
| **Titre conversation** | — | Champ éditable, PATCH ; modal ou inline. |
| **Suppression conversation** | — | Bouton + modal de confirmation, DELETE puis redirection ou nouvelle conversation. |
| **Panneau admin** | — | Page/section pour modifier rag_settings (context_turns, similarity_threshold, guard_message, etc.) avec descriptions et validation. |
| **Veille — Liste** | Page Bibliographie existante. | Afficher liste rankée (titre, abstract, URL, score) depuis l’API veille. |
| **Veille — Déclenchement** | — | Bouton pour lancer une run (job asynchrone), affichage du statut si prévu. |
| **Documents** | — | Upload + liste des documents (titre, statut, lien PDF) dans la section Bibliographie. |

---

## 8. Références vers les autres documents

| Document | Contenu |
|----------|---------|
| **Vue d’ensemble projet** | Besoins, flows, structure. |
| **Stack et technologies** | Rôle des technos (Next.js, Supabase, etc.). |
| **Back RAG** | API chat, recherche, garde-fou, paramètres, bilingue, conversations (détail back). Fichier : `BACK_RAG.md`. |
| **Veille** | Flux, garde-fous, similarité, tests. Fichier : `VEILLE.md`. |
| **Schéma DB et données** | Tables, migrations, flows back ↔ DB. Fichier : `SCHEMA_DB_ET_DONNEES.md`. |
