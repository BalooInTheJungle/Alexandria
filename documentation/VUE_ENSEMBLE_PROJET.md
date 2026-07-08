# Vue d’ensemble du projet Alexandria

**Rôle** : référence globale pour documenter le projet — besoins, problématique, utilisateurs, structure, flows d’usage et de données. Ce document sert de socle pour le schéma fonctionnel et la navigation vers les autres docs.

> Mis à jour le 06/07/2026 : les §1-4, 7, 10, 11 (contexte, besoins, personas, questions ouvertes, positionnement) décrivent le projet tel que défini par le chercheur et restent valides — non vérifiables par le code, non modifiés. Les §5, 6, 8, 9 (vision technique, flows, structure) décrivaient un plan pré-implémentation largement dépassé (RAG en page unique, veille en scraping HTML+LLM, pas de module Analyse) — réécrits pour refléter l'architecture réelle. Voir `documentation/STRUCTURE_ET_ARCHITECTURE.md` pour le détail à jour.

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

## 4. Données existantes (corpus historique du chercheur)

| Caractéristique | Valeur |
|-----------------|--------|
| **Volume** | ~10 000 articles |
| **Taille** | Un peu moins de 100 Go |
| **Période** | Accumulation sur **20 ans** |
| **Formats** | Majoritairement **PDF natifs** (texte extractible) |
| **Structure** | Bien structurés : métadonnées (titre, auteurs, revue, DOI), sections, figures, tables |
| **Cas marginaux** | PDF scannés → **OCR en fallback** à prévoir |

> **Attention à ne pas confondre** avec le corpus **déjà ingéré dans Alexandria** à ce jour : ~3 700 documents corpus (années 2024-2026) + 521 articles auteur, selon `CLAUDE.md` (section "État actuel"). Le chiffre ci-dessus (~10 000, 20 ans) est l'archive personnelle complète du chercheur, cible finale de l'ingestion, pas l'état actuel de la base. Pour un chiffre à jour, se référer à `CLAUDE.md` ou interroger la base directement plutôt que ce document.

---

## 5. Ce qui a réellement été construit (remplace la vision initiale, 3 axes)

L'ancienne version de cette section décrivait 2 axes visés avant développement (RAG socle, veille scraping HTML). Le produit final s'est structuré en **3 modules**, avec des choix techniques différents de l'intention initiale :

### 5.1 Veille automatisée

- **Pas de scraping HTML** des ~50 sources : extraction par **flux RSS** (44-46 sources actives) + **OpenAlex**/**CrossRef** pour vérifier qu'un article est bien publié définitivement (pas un preprint/ASAP), + **Semantic Scholar** en source de recommandations optionnelle.
- Tourne **automatiquement chaque jour** (cron GitHub Actions), pas de déclenchement manuel en usage normal.
- Score de similarité vs corpus (`similarity_score`) **et** vs les seuls articles publiés par le chercheur (`author_score`), calculés en parallèle.
- Résultat : liste d'articles ≥75% affichée sur `/bibliographie`, avec analyse IA individuelle (GPT-4o-mini) pour les mieux classés, et synthèse globale du jour.
- Détail complet : `documentation/PIPELINE_VEILLE_CONSOLIDE.md`.

### 5.2 Analyse de document (absent de la vision initiale)

Ce module n'existait pas dans le plan d'origine. Il permet d'uploader un PDF individuel (hors ingestion bulk) et d'obtenir : résumé structuré GPT, proximité avec le corpus, références citées croisées avec Semantic Scholar, discussion IA (chat), et une intégration en un clic au corpus permanent. Détail : `CLAUDE.md` (section Analyse), `documentation/BACK_RAG.md`.

### 5.3 RAG scientifique — devenu une brique interne, pas une page autonome

Le chat RAG sur le corpus existe toujours (recherche hybride FTS + vector + RRF, réponses sourcées, citations), mais **vit dans l'onglet Discussion du module Analyse** depuis juin 2026 — il n'y a plus de page `/rag` dédiée. Pas de recherche multi-critères (auteurs/journaux/dates) implémentée en tant que telle : la recherche reste sémantique + lexicale sur le contenu des chunks.

---

## 6. Architecture réelle et décisions (remplace la section "cible")

- **Toujours entièrement cloud** : Supabase (Postgres, pgvector, Storage, Auth) + Vercel (front, API) — confirmé, pas de changement sur ce point.
- **Mais l'exécution est répartie sur deux plateformes** : Vercel héberge le front et les API de lecture ; **la pipeline veille tourne dans GitHub Actions** (scripts Node.js directs), pas sur Vercel — migration motivée par le timeout 10s du plan Vercel Hobby (voir `docs/VEILLE_PIPELINE_REFACTOR.md`).
- **Centralisation** : toujours une seule app, mais **3 zones** (Bibliographie / Analyse / Database), pas "RAG + Bibliographie" comme prévu — le module Analyse a remplacé la page RAG autonome.
- **Stockage PDF** : plusieurs emplacements coexistent — `data/pdfs2/` (corpus bulk, organisé par année de **publication**, pas `data/pdfs/`), `data/Articles auteur/` (articles du chercheur), et le bucket Supabase Storage `analyses` (PDFs uploadés via le module Analyse).
- **Veille** : RSS structuré + APIs scientifiques (OpenAlex, CrossRef, Semantic Scholar) — **pas** de scraping HTML de pages listing comme envisagé initialement. Similarité calculée sur l'abstract, **découpé en plusieurs chunks** (pas embeddé en un seul vecteur) pour améliorer la précision.

---

## 7. Utilisateurs et personas

| Persona | Rôle | Besoins principaux | Contraintes |
|---------|------|--------------------|-------------|
| **Chercheur (porteur)** | Utilisateur principal ; propriétaire du corpus | RAG sur le corpus ; veille rankée ; upload manuel des PDFs ; réponses sourcées (FR ou EN) | Temps limité ; critères de pertinence exigeants |
| **User (ex. prof / collègue)** | Utilisateur autorisé | Accès RAG + veille ; upload de PDFs si autorisé | Documents scientifiques ; accès contrôlé |
| **Système (jobs)** | Pas d’utilisateur humain | Scraping ; ingestion après upload ; indexation | Coût/ressources maîtrisés |

**Implications** : login obligatoire (Supabase Auth) ; upload manuel des PDFs depuis le front (pas d’ingestion automatique depuis la veille en POC) ; une seule interface : RAG + Bibliographie + documents.

---

## 8. Flows d’usage réels

### 8.1 Flow « Discussion » (chat RAG, dans le module Analyse)

1. Utilisateur connecté ouvre un document dans `/analyse/[id]`, onglet **Discussion**.
2. Saisit une requête (français ou anglais) — **pas de détection de langue** côté recherche : le prompt système demande simplement au LLM de répondre dans la langue de la question.
3. **Recherche** : FTS anglais + vectorielle (`match_chunks`, corpus + chunks du document) → fusion RRF → top-K chunks.
4. **Garde-fou** (si activé) : si meilleure similarité < seuil → message fixe, pas d'appel LLM. Sinon possibilité de mode "connaissances générales" si le garde-fou est désactivé (voir `BACK_RAG.md` §2.3).
5. **LLM** (GPT-4o-mini) avec contexte + historique → réponse sourcée en streaming.
6. Citations `[1]`, `[2]`… + infos document ; lien PDF (scroll synchronisé).

### 8.2 Flow « Veille / Bibliographie » (automatique, sans action utilisateur)

1. Cron GitHub Actions (7h UTC) déclenche 4 jobs séquentiels : extraction RSS/OpenAlex → scoring → analyse IA individuelle → synthèse globale. Détail complet : `PIPELINE_VEILLE_CONSOLIDE.md`.
2. Utilisateur connecté consulte `/bibliographie` (lecture seule) : liste paginée ≥75%, filtres lu/pertinence, historique des runs, gestion des sources.
3. Utilisateur peut marquer un article lu/pertinent (feedback manuel, `is_relevant`), sans influencer le scoring automatique.

### 8.3 Flow « Analyse d'un document » (remplace "Ajout de documents")

1. Utilisateur connecté accède à `/analyse`, dépose un PDF (ou clique "Analyser le PDF" sur un article de veille suggéré).
2. Upload → parsing, chunking, embedding → `document_analyses` + chunks temporaires (`is_temp=true`).
3. Insights calculés (résumé, proximité corpus, références citées, recommandations Semantic Scholar).
4. Consultation via les 4 onglets ; discussion possible immédiatement.
5. **Intégration au corpus** (optionnelle, 1 clic) : `is_temp=false`, le document devient définitivement cherchable dans le RAG.

### 8.4 Flow « Ingestion bulk » (remplace l'ancien upload comme voie principale)

Le chercheur ne dépose pas ses PDFs un par un pour peupler le corpus général : `scripts/ingest.py` lit `data/pdfs2/YEAR/` en masse (voir §5 et `STACK_ET_TECHNOLOGIES.md`). L'upload individuel (`/api/documents/upload`, page Database) existe mais est un complément, pas le flux principal d'alimentation du corpus.

---

## 9. Structure du projet (résumé, voir `STRUCTURE_ET_ARCHITECTURE.md` pour le détail à jour)

- **Une app Next.js**, 3 zones dans le dashboard : Bibliographie, Analyse, Database (plus de page `/rag` autonome).
- **RAG** : `lib/rag/` (search, embed, openai, citations, conversation-persistence, settings — `rerank.ts` présent mais non appelé, code mort) ; `app/api/rag/` réutilisé par le module Analyse.
- **Veille** : `scripts/veille/*.ts` (4 jobs GitHub Actions) + `lib/veille/` (sources, fetch-rss, openalex, crossref, score, summarize) — pas de scraping HTML, pas de fichiers `guardrails.ts`/`filter-urls-llm.ts`/`extract-article-llm.ts`.
- **Analyse** : `app/api/analyse/*` (upload, insights, chat, integrate) ; `document_analyses` + chunks `is_temp`.
- **Ingestion** : `scripts/ingest.py` (bulk) ; `lib/ingestion/` (parse-pdf, chunk, index) réutilisé par les deux routes d'upload (documents et analyse).
- **Données** : `data/pdfs2/` (corpus par année de publication), `data/Articles auteur/` ; Supabase Postgres (`documents`, `chunks`, `sources`, `veille_runs`, `veille_items`, `conversations`, `messages`, `rag_settings`, `document_analyses`, `query_logs`, `ss_representative_papers`), pgvector, Auth, Storage (`analyses`).

Détail des dossiers, schéma DB et flows back ↔ DB : voir `SCHEMA_DB_ET_DONNEES.md` et `STRUCTURE_ET_ARCHITECTURE.md`.

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
| **Fonctionnalités Front** | Bibliographie, Analyse, Database — pages, composants, état réel. Fichier : `FONCTIONNALITES_FRONT.md`. |
| **Pipeline veille** | Flux GitHub Actions, RSS/OpenAlex/CrossRef, garde-fous, seuils. Fichier : `PIPELINE_VEILLE_CONSOLIDE.md`. |
| **Schéma DB et données** | Tables Supabase, colonnes, tableau des migrations (52), flows numérotés back ↔ DB. Fichier : `SCHEMA_DB_ET_DONNEES.md`. |
| **Structure et architecture** | Arborescence réelle des dossiers, modules. Fichier : `STRUCTURE_ET_ARCHITECTURE.md`. |

Ces documents sont à utiliser ensemble pour avoir le schéma fonctionnel complet du projet.
