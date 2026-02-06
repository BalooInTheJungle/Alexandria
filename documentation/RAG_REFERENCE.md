# Référence module RAG — Alexandria

**Objectif** : document de référence pour le pipeline RAG (stockage PDF, ingestion, recherche, génération de réponses).

---

## 1. Objectif et périmètre

- **Corpus** : PDFs déposés localement dans le projet (dossier **data/pdfs/**).
- **Pas de lien externe** : les PDF ne sont pas hébergés sur Supabase ni exposés par URL ; on les récupère via le dossier, on les embed, on stocke en base. Le RAG s’appuie uniquement sur les **vecteurs** (et FTS) en DB.
- **Retrouver les éléments** : recherche possible dans la base du chercheur par **titre**, **DOI**, **auteurs** (index et champs en DB).

---

## 2. Stockage des PDF

| Élément | Décision |
|--------|----------|
| **Emplacement** | Dossier **data/pdfs/** à la racine du projet. |
| **Versionnement** | Les fichiers `*.pdf` sont ignorés par Git (`.gitignore`) ; seul le dossier et le README sont versionnés. |
| **Lien document → fichier** | En base, `documents.storage_path` stocke le **chemin relatif** (ex. `data/pdfs/mon-article.pdf`) pour retrouver le fichier. |
| **Référence** | Voir `data/README.md`. |

---

## 3. Ingestion (parsing → chunks → embeddings)

### 3.1 Déclenchement

- **Pour l’instant** : processus lancé **à la main** (script ou commande, pas d’upload via l’interface).
- **À terme** : possibilité d’ajouter des documents via l’interface (à réfléchir).

### 3.2 Étapes

1. **Lecture du dossier**  
   Parcourir **data/pdfs/** et lister les PDF (éventuellement filtrer ceux déjà en base via `storage_path` ou DOI).

2. **Parsing PDF**  
   - Extraire le **texte** (outil type PyMuPDF / pdfplumber ; fallback OCR si PDF scanné).  
   - Extraire les **métadonnées depuis le PDF** (pas de saisie manuelle) : titre, auteurs, DOI, journal, date (première page, champs XMP ou heuristiques).

3. **Création / mise à jour `documents`**  
   Une ligne par PDF : titre, authors, doi, journal, published_at, storage_path (chemin relatif), status = `processing` puis `done` ou `error`.

4. **Chunking**  
   - **Priorité** : découpage **par section** (Introduction, Methods, Results, etc.) quand le parseur le permet — important pour des documents longs.  
   - **Fallback** : chunks de taille fixe avec overlap si la structure n’est pas détectable.  
   - Conserver **position**, **page**, et si possible **section_title** pour les citations.

5. **Embeddings**  
   - **Open source, local** : pas de coût, modèle tournant sur le PC (sentence-transformers, Ollama embedding, ou équivalent).  
   - Même modèle pour l’indexation et pour la requête (recherche).  
   - Dimension à aligner avec le schéma `chunks.embedding` (ex. 384, 768 ou 1536 selon le modèle ; voir `SCHEMA_SUPABASE.md`).

6. **Écriture en base**  
   Insertion des **chunks** (content, document_id, position, page, section_title, embedding, content_tsv pour FTS).

**Implémentation** : script Python **scripts/ingest.py** (voir **scripts/README.md**).  
- Lecture de **data/pdfs/*.pdf**, parse PyMuPDF, **fallback OCR** (Tesseract) si une page contient très peu de texte (PDF scanné).  
- Métadonnées extraites du PDF (titre, DOI heuristique, etc.).  
- Chunking par section (Abstract, Introduction, Methods…) ou par taille fixe + overlap.  
- Embeddings **sentence-transformers all-MiniLM-L6-v2** (384D) ; exécuter la migration **20260204100006_chunks_embedding_384.sql** pour aligner la colonne `chunks.embedding` sur 384.  

**Paramètres et flow détaillés** : **documentation/INGESTION_EMBEDDING.md**.  
**Points à surveiller avant extraction massive** : **documentation/AVANT_EXTRACTION.md**.

### 3.3 Retrouver les documents

- En base : requêtes sur **documents** filtrées par **titre**, **DOI**, **auteurs** (index existants).  
- Côté app : possibilité d’afficher la liste des documents indexés (titre, DOI, auteurs) et de retrouver le fichier via `storage_path` (lecture depuis le disque local).

---

## 4. Recherche (FTS + vector + fusion)

### 4.1 Embeddings

- **Modèle** : open source, local (pas de coût).  
- **Requête** : la requête utilisateur est embedée avec le **même modèle** que les chunks.

### 4.2 Fusion lexical / sémantique

- **Objectif** : bonne récupération des données, limiter l’interprétation côté modèle en lui donnant des chunks pertinents.
- **Recommandation** :  
  - **Fusion RRF** (Reciprocal Rank Fusion) entre résultats FTS et résultats vectoriels — robuste, peu de réglage.  
  - **Paramètres ajustables** : possibilité d’exposer (config ou UI) le poids FTS vs vectoriel ou le paramètre RRF (ex. k) pour affiner selon les retours.
- **Top-K** : envoyer au rerank / LLM un nombre de chunks maîtrisé (ex. top 20 à 50) ; à ajuster selon la qualité des réponses.

### 4.3 Filtres optionnels

- Filtrage par **métadonnées** (auteur, journal, période) possible en amont ou en aval de la recherche hybride (requêtes Supabase filtrées).

---

## 5. Rerank (optionnel)

- **But** : améliorer la précision des chunks envoyés au LLM.  
- **Recommandation** : pour une « meilleure version » du retrieval et de la génération, un **rerank léger** (ex. cross-encoder ou modèle dédié) sur le top-K peut être ajouté ; pour le POC, on peut commencer **sans rerank** (FTS + vector + fusion → top-K direct au LLM) et l’ajouter si besoin.

---

## 6. Génération (LLM)

### 6.1 Modèle et config

- **API OpenAI** : génération des réponses (Chat Completions).  
- Variable d’environnement **OPENAI_API_KEY** (côté serveur uniquement) ; voir `.env.local.example`.  
- Modèle utilisé par défaut : `gpt-4o-mini` (à modifier dans `lib/rag/openai.ts` si besoin).

### 6.2 Format des réponses

- **Citations** : en **fin de phrase** (ex. [1], [2]) qui renvoient aux sources.  
- **Contexte** : le LLM reçoit la requête + les chunks sélectionnés ; instruction dans le prompt pour s’appuyer uniquement sur le contexte et citer les sources.

### 6.3 Qualité

- Objectif : **meilleure récupération** (retrieval) et **génération fiable** (réponses ancrées dans les chunks, pas d’hallucination).  
- Rerank + top-K maîtrisé + prompt explicite limitent l’interprétation abusive du modèle.

---

## 7. Chatbot (historique, contexte, garde-fou, streaming)

### 7.1 Historique des conversations

- **Persistance** : conversations et messages stockés en base (`conversations`, `messages`). L’utilisateur revient → voit la **liste** (sidebar : titre + date) et peut rouvrir une conversation.
- **Durée de vie** : **30 jours** ; nettoyage par job planifié ou manuel (voir SCHEMA_SUPABASE.md).
- **Titre** : généré à la création (API ou troncature du premier message) ; **éditable à la main** par l’utilisateur.

### 7.2 Contexte multi-tours

- **N derniers échanges** (user + assistant) envoyés au LLM en plus du contexte RAG et de la nouvelle question. **N paramétrable** (défaut 3) depuis le **panneau admin** (`rag_settings.context_turns`).
- À chaque nouveau message : **recherche vectorielle** sur la **dernière question** uniquement ; les chunks + les N derniers messages + la nouvelle question sont envoyés au LLM.

### 7.3 Garde-fou « hors domaine »

- **Règle** : après la recherche vectorielle, si la **meilleure similarité** (meilleur chunk) est **< seuil** (ex. 0,5) → requête considérée **hors du domaine** (recherche fondamentale).
- **Comportement** : **pas d’appel OpenAI** ; retour d’un **message configuré** (ex. « Requête trop éloignée de la recherche fondamentale. »). Le message user + la réponse garde-fou sont **enregistrés** en base.
- **Paramètres** (admin) : seuil de similarité, texte du message hors domaine (`rag_settings.similarity_threshold`, `rag_settings.guard_message`). Voir CHATBOT_GENERATION_ET_GARDE_FOU.md.

### 7.4 Streaming

- La **réponse du chatbot** doit s’afficher **en streaming** dans l’interface (texte au fur et à mesure). API chat en **ReadableStream** (ou SSE) ; OpenAI Chat Completions avec `stream: true`. À la fin du stream : enregistrement du message assistant complet en base.

### 7.5 Panneau admin

- **Paramètres** modifiables sans redéploiement : nombre de tours de contexte, seuil similarité (garde-fou), message hors domaine, optionnellement match_count / match_threshold. Stockage : table `rag_settings` (voir SCHEMA_SUPABASE.md).

**Références détaillées** : **BESOINS_CHATBOT_FRONT.md** (besoins front/back), **CHATBOT_GENERATION_ET_GARDE_FOU.md** (méthodologie génération et garde-fou).

---

## 8. Interface utilisateur (RAG)

### 8.1 Modes de requête

- **Recommandation** : proposer **deux usages** :  
  1. **Recherche** : requête → FTS + vector → fusion → affichage des passages / chunks pertinents (sans génération LLM).  
  2. **Question** (chatbot) : même retrieval + envoi du contexte (N derniers messages + chunks) au LLM → réponse générée avec citations, **en streaming**.

### 8.2 Affichage des sources

- Pour chaque citation ou source affichée : **point « i » (info)** au survol (ou au clic) qui montre les **informations du document** : titre, auteurs, DOI, journal, date, page/section si disponible.  
- Pas de lien externe vers un « document » en ligne : le document est local (data/pdfs/) ; l’UI peut proposer d’ouvrir le fichier local ou d’afficher le chemin si pertinent.

---

## 9. Flux résumé

```
[PDFs dans data/pdfs/]
        ↓
  Ingestion (manuel)
        ↓
  Parse PDF → métadonnées (titre, auteurs, DOI, journal, date) + texte
        ↓
  Chunking (sections si possible, sinon taille fixe)
        ↓
  Embedding (modèle local open source)
        ↓
  Écriture documents + chunks en DB (storage_path = chemin relatif)
        ↓
  ─────────────────────────────────────────────────────────────
  Requête utilisateur (chatbot ou recherche)
        ↓
  Charger N derniers messages de la conversation (si reprise)
        ↓
  Embedding de la requête (même modèle 384D)
        ↓
  Recherche vectorielle (match_chunks) → chunks + best_similarity
        ↓
  Si best_similarity < seuil_garde_fou → message hors domaine (pas d’appel LLM) ; enregistrer en base
        ↓
  Sinon : LLM (OpenAI) avec contexte (N derniers messages + chunks) + citations [1], [2]… en streaming
        ↓
  Affichage : réponse en streaming + sources ; point « i » au survol = infos doc (titre, DOI…)
```

---

## 10. Décisions validées (synthèse)

| Sujet | Décision |
|-------|----------|
| Stockage PDF | Dossier **data/pdfs/** dans le projet ; pas de Supabase Storage ; `storage_path` = chemin relatif. |
| Déclenchement ingestion | **Manuel** pour l’instant ; plus tard possibilité d’ajout de documents via l’interface. |
| Métadonnées documents | **Extraites depuis le PDF** (pas de saisie manuelle). |
| Retrouver les documents | Par **titre**, **DOI**, **auteurs** en base. |
| Chunking | **Par section** si possible (documents longs) ; fallback taille fixe. |
| Embeddings | **Open source, local** (pas de coût ; PC fait tourner le modèle). |
| Fusion | **Paramètres ajustables** ; recommandation **RRF** pour robustesse. |
| Rerank | À la discrétion du dev ; objectif meilleure précision (optionnel en POC). |
| LLM | **API OpenAI** (génération uniquement ; embeddings locaux 384D). |
| Citations | **En fin de phrase** ([1], [2]…). |
| UX | **Deux modes** : recherche (retrieval seul) + question (chatbot RAG avec génération en **streaming**). **Point « i »** au survol pour infos du document. **Historique** : conversations + messages en base, 30 jours, sidebar titre + date. **Garde-fou** : si similarité < seuil → message hors domaine, pas d’appel LLM. **Contexte** : N derniers messages (paramétrable). **Admin** : paramètres (seuil, message hors domaine, N) dans `rag_settings`. |

---

## 11. Références

| Document | Contenu |
|----------|---------|
| **STRUCTURE_ET_ARCHITECTURE.md** | Structure des dossiers, rôle de `data/pdfs/`, flux globaux. |
| **SCHEMA_SUPABASE.md** | Tables `documents`, `chunks`, `conversations`, `messages`, `rag_settings`, rétention 30 jours. |
| **BESOINS_CHATBOT_FRONT.md** | Besoins chatbot (front + back) : historique, contexte, garde-fou, streaming, admin. |
| **CHATBOT_GENERATION_ET_GARDE_FOU.md** | Méthodologie : génération avec historique, garde-fou, paramètres, streaming. |
| **data/README.md** | Rôle du dossier `data/pdfs/` et lien avec l’ingestion. |
