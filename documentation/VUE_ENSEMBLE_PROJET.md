# Vue d’ensemble du projet Alexandria

**Rôle** : référence globale pour documenter le projet — besoins, problématique, utilisateurs, structure, flows d’usage et de données. Ce document sert de socle pour le schéma fonctionnel et la navigation vers les autres docs.

---

## 1. Contexte et porteur du projet

| Élément | Description |
|--------|--------------|
| **Porteur** | Chercheur en recherche fondamentale au **CNRS** |
| **Domaine** | **Molecular Materials & Magnetism** (matériaux moléculaires, magnétisme) |
| **Type de recherche** | Fondamentale : théorie + expérimentation |
| **Contexte institutionnel** | Contraintes de sécurité et conformité CNRS ; **hébergement cloud maintenu à terme** (pas de passage on-prem). |

---

## 2. Périmètre scientifique et critères de sélection

### 2.1 Domaine cible

- Molecular Materials  
- Magnetism  
- Recherche fondamentale (théorie + expérimentation)

### 2.2 Critères de pertinence des articles

- **Auteurs** (reconnaissance, continuité de lecture)  
- **Laboratoires** (réseaux, collaborations)  
- **Proximité thématique** avec les travaux du chercheur  
- **Similarité scientifique** avec le corpus historique (embeddings, FTS)

**Important** : pas de critères basés sur l’**impact factor** ou les **citations** (articles lus le jour ou la semaine de leur publication ; métriques bibliométriques pas encore disponibles).  
**Objectif** : identifier à la fois des travaux **incrémentaux** et des **ruptures** scientifiques.

---

## 3. Processus actuel de veille (pain points)

| Aspect | Situation actuelle |
|--------|--------------------|
| **Fréquence** | 1 h à 1 h 30, principalement mercredi et vendredi |
| **Méthode** | Lecture des **titres** puis des **résumés** |
| **Prises de notes** | Pas de structuration |
| **Décision** | Implicite (conservation / rejet) |
| **Stockage** | Cloud personnel, classement par années |

**Problèmes** : temps limité, pas de priorisation explicite, capital scientifique peu exploitable de façon transversale.

---

## 4. Données existantes (corpus historique)

| Caractéristique | Valeur |
|-----------------|--------|
| **Volume** | ~10 000 articles |
| **Taille** | Un peu moins de 100 Go |
| **Période** | Accumulation sur **20 ans** |
| **Formats** | Majoritairement **PDF natifs** (texte extractible) |
| **Structure** | Bien structurés : métadonnées (titre, auteurs, revue, DOI), sections, figures, tables |
| **Cas marginaux** | PDF scannés → **OCR en fallback** à prévoir |

---

## 5. Objectifs fonctionnels (vision cible)

### 5.1 Axe 1 — RAG scientifique (socle)

- Vectorisation du corpus historique ; stockage en base (pgvector + FTS).  
- **Fonctionnalités** : recherche **multi-critères** (auteurs, journaux, dates, mots-clés) ; recherche **multi-contextuelle** (requête naturelle, similarité sémantique) ; interrogation **transversale** du corpus.  
- **Réponses** : sourcées, avec citations ; réponse dans la **même langue** que la requête (français ou anglais) ; lien vers le PDF original.  
- **Objectif** : exploitation intelligente de 20 ans de connaissances ; réponses ancrées dans le contexte, traçabilité.

### 5.2 Axe 2 — Veille automatisée et scoring de pertinence

- Scraping automatique des **~50 sources** scientifiques (HTML).  
- Récupération des **nouveaux articles** (ex. hebdomadaire) ; **score de similarité** (abstract vs corpus ou index abstracts).  
- **Résultat** : classement par **pertinence scientifique personnalisée** ; liste rankée avec URL.  
- **À terme** : embedding abstract vs DB vectorielle → score → priorisation.

---

## 6. Architecture cible et décisions

**Décision** : projet **entièrement sur cloud** (POC jusqu’à production) ; pas de migration on-prem.

- **Interface** : web Next.js.  
- **Hébergement** : Supabase (Postgres, pgvector, Storage, Auth) ; front (ex. Vercel ou équivalent).  
- **Centralisation** : une seule app — RAG + Bibliographie (veille) + gestion des documents ; une seule base Supabase.  
- **Stockage PDF** : en POC les PDFs sont dans le projet (**data/pdfs/**) ; `documents.storage_path` = chemin relatif. À terme possiblement Supabase Storage.  
- **Veille** : HTML scraping uniquement ; liste des sources en base ; similarité sur l’**abstract** uniquement.

---

## 7. Utilisateurs et personas

| Persona | Rôle | Besoins principaux | Contraintes |
|---------|------|--------------------|-------------|
| **Chercheur (porteur)** | Utilisateur principal ; propriétaire du corpus | RAG sur le corpus ; veille rankée ; upload manuel des PDFs ; réponses sourcées (FR ou EN) | Temps limité ; critères de pertinence exigeants |
| **User (ex. prof / collègue)** | Utilisateur autorisé | Accès RAG + veille ; upload de PDFs si autorisé | Documents scientifiques ; accès contrôlé |
| **Système (jobs)** | Pas d’utilisateur humain | Scraping ; ingestion après upload ; indexation | Coût/ressources maîtrisés |

**Implications** : login obligatoire (Supabase Auth) ; upload manuel des PDFs depuis le front (pas d’ingestion automatique depuis la veille en POC) ; une seule interface : RAG + Bibliographie + documents.

---

## 8. Flows d’usage

### 8.1 Flow « Recherche RAG »

1. Utilisateur **connecté** accède à la section **RAG**.  
2. Saisit une **requête** (en **français** ou en **anglais**).  
3. Système : **détection de la langue** de la requête (explicite, avant recherche) → choix de la **pipeline** (EN ou FR).  
4. **Recherche** : FTS + vectorielle sur le bon index (EN : `content` / `embedding` / FTS english ; FR : `content_fr` / `embedding_fr` / FTS french) → **fusion RRF** → top-K chunks.  
5. **Garde-fou** : si meilleure similarité &lt; seuil → message hors domaine (pas d’appel LLM).  
6. Sinon : **LLM** (OpenAI) avec contexte (chunks dans la langue de la requête) + instruction « Réponds en français » ou « Réponds en anglais » → **réponse sourcée** en streaming.  
7. **Citations** [1], [2]… + infos document (titre, DOI, section, page) ; lien vers le PDF.  
8. Utilisateur consulte la réponse et peut ouvrir le PDF original.

### 8.2 Flow « Veille / Bibliographie »

1. **Job** (cron ou manuel) : récupère la **liste des sources** depuis Supabase.  
2. **Scraping HTML** : pour chaque source, extraction **titre, abstract, URL** (et métadonnées si dispo).  
3. **Déduplication** (DOI / titre).  
4. **Embedding** des abstracts → **score de similarité** vs corpus (ou index abstracts).  
5. **Enregistrement** des items (veille_runs, veille_items) avec score.  
6. Utilisateur **connecté** accède à la section **Bibliographie** : voit une **liste rankée** avec URL, abstract, score.  
7. Utilisateur clique sur l’URL pour lire l’article sur la source.

### 8.3 Flow « Ajout de documents (upload) »

1. Utilisateur **connecté** accède à **Documents** (section Bibliographie).  
2. **Upload** d’un ou plusieurs PDFs (front → API).  
3. API : enregistrement **document** (métadonnées) ; fichier en **data/pdfs/** ou Storage selon déploiement.  
4. **Ingestion** : parsing PDF (texte + fallback OCR) → **chunking** (sections) → **embeddings** (et, si bilingue, traduction locale EN→FR + `embedding_fr` + FTS french) → écriture **chunks** (FTS + pgvector).  
5. Le document devient **searchable** dans le RAG (EN et, si prévu, FR).

### 8.4 Flow « Incrémentation RAG par la veille » (à terme)

1. Depuis la **liste veille**, l’utilisateur marque un article comme « à ajouter au corpus ».  
2. Si **lien PDF** disponible : téléchargement puis **upload** → même pipeline qu’en 8.3.  
3. Sinon : l’utilisateur récupère le PDF et l’upload via **Documents**.

---

## 9. Structure du projet (résumé)

- **Une app Next.js** : `app/` (Auth, Dashboard avec RAG + Bibliographie, API routes).  
- **RAG** : `app/rag/` (page) ; `app/api/rag/` (chat, search) ; `lib/rag/` (search, embed, openai, citations, conversation-persistence, settings, rerank).  
- **Veille** : `app/api/veille/` (scrape, list) ; `lib/veille/` (sources, fetch, extract, guardrails, LLM, score).  
- **Documents / Ingestion** : `app/api/documents/upload/`, `app/api/ingestion/` ; `lib/ingestion/` (parse-pdf, chunk, index) ; `lib/db/` (documents, chunks, sources, veille, types).  
- **Données** : `data/pdfs/` (PDFs à indexer) ; **Supabase** : Postgres (documents, chunks, sources, veille_runs, veille_items, conversations, messages, rag_settings), pgvector, Auth.  

Détail des dossiers, schéma DB et flows back ↔ DB : voir **Schéma DB et données** (§6).

---

## 10. Questions ouvertes (cadrage)

- **Scoring** : seuil de pertinence automatique ? Pondération manuelle (auteur, laboratoire, thématique) ?  
- **RAG** : comparaison explicite entre plusieurs articles ? Exploration libre vs réponses à hypothèses précises ?  
- **Veille** : notification proactive ou tableau hebdomadaire ? Fraîcheur vs pertinence ?  
- **Mesure** : temps économisé, taux d’articles lus, boucle de feedback pour améliorer scoring / RAG ?

---

## 11. Positionnement méthodologique

- **Augmentation du chercheur** (outil d’aide à la décision), pas un remplacement.  
- **Valorisation d’un capital scientifique dormant** (20 ans de littérature).  
- **IA explicable** : sources, critères, traçabilité.

---

## 12. Références vers les autres documents

| Document | Contenu |
|----------|---------|
| **Stack et technologies** | Technologies utilisées dans le projet et leur rôle (Next.js, Supabase, embeddings, FTS, pgvector, LLM, etc.). Fichier : `STACK_ET_TECHNOLOGIES.md`. |
| **Back RAG** | API RAG, ingestion des données, génération de réponses, paramétrage dynamique (rag_settings), multilingue (FR/EN), conversations et messages ; récap par thème avec priorité. Fichier : `BACK_RAG.md`. |
| **Fonctionnalités Front** | RAG (chat, sources, citations, langue, garde-fou, streaming) + Veille (liste rankée, URLs) ; pages, composants, à faire. Fichier : `FONCTIONNALITES_FRONT.md`. |
| **Pipeline veille** | Étapes du scraping, extraction, garde-fous, similarité vs DB, décisions. Fichier : `PIPELINE_VEILLE_CONSOLIDE.md`. |
| **Schéma DB et données** | Tables Supabase, colonnes, tableau des migrations, flows numérotés back ↔ DB ; prévision bilingue. Fichier : `SCHEMA_DB_ET_DONNEES.md`. |

Ces documents sont à utiliser ensemble pour avoir le schéma fonctionnel complet du projet.
