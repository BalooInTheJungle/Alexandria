# Vue d’ensemble du projet Alexandria

**Document** : besoin, problématique, utilisateurs, flows d’usage — référence globale pour le mémoire et l’équipe.

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

**Important** : pas de critères basés sur l’**impact factor** ou les **citations**, car :

- Les articles sont lus **le jour ou la semaine de leur publication**  
- Les métriques bibliométriques ne sont pas encore disponibles  

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

- Vectorisation de l’ensemble du corpus historique  
- Stockage en base vectorielle (pgvector) + FTS  
- **Fonctionnalités** :  
  - Recherche **multi-critères** (auteurs, journaux, dates, mots-clés)  
  - Recherche **multi-contextuelle** (requête naturelle, similarité sémantique)  
  - Interrogation **transversale** du corpus  
- **Objectif** : exploitation intelligente de 20 ans de connaissances accumulées ; réponses sourcées et lien vers le PDF original.

### 5.2 Axe 2 — Veille automatisée et scoring de pertinence

- Scraping automatique des **~50 sources** scientifiques (HTML)  
- Récupération des **nouveaux articles** (ex. hebdomadaire)  
- **Score de similarité** entre :  
  - Nouveaux articles (abstract)  
  - Corpus historique (ou index dédié abstracts)  
- **Résultat** : classement par **pertinence scientifique personnalisée** ; priorisation des lectures à forte valeur ajoutée ; liste rankée avec URL.  
- **À terme** : comparer les sources récupérées avec la **DB vectorielle** pour une **analyse de similarité** (embedding abstract vs corpus → score → priorisation).

---

## 6. Architecture cible et restitution (tout sur cloud)

**Décision** : le projet reste **entièrement sur cloud** de la phase POC jusqu’à la production ; pas de migration on-prem prévue.

### 6.1 Phase 1 — Proof of Concept (cloud)

- **Interface** : web (Next.js)  
- **Hébergement** : cloud (Supabase : Postgres, pgvector, Storage)  
- **Objectifs** : valider l’usage, tester l’ergonomie, affiner les critères de scoring  

### 6.2 Phase 2 — Consolidation / production (cloud)

- **Hébergement** : toujours sur cloud (Supabase + hébergeur front type Vercel ou équivalent).  
- **Fonctions** : stockage, moteur de recherche vectorielle, exécution des modèles IA (API ou services cloud).  
- **Enjeux** : sécurité, conformité CNRS, coûts maîtrisés, pas d’infra locale à maintenir.  

---

## 7. Utilisateurs et personas

| Persona | Rôle | Besoins principaux | Contraintes |
|---------|------|--------------------|-------------|
| **Chercheur (porteur)** | Utilisateur principal ; propriétaire du corpus | RAG sur le corpus ; veille rankée ; upload manuel des PDFs ; réponses sourcées | Temps limité ; critères de pertinence exigeants |
| **User (ex. prof / collègue)** | Utilisateur autorisé | Accès au même outil (RAG + veille) ; possibilité d’upload de PDFs si autorisé | Documents scientifiques réservés ; accès contrôlé |
| **Système (jobs)** | Pas d’utilisateur humain | Scraping hebdo ; ingestion après upload ; indexation | Pas d’API officielle pour la veille ; coût/ressources maîtrisés |

**Implications** :  
- **Login obligatoire** (Supabase Auth).  
- **Upload manuel** des PDFs depuis le front (pas d’ingestion automatique depuis la veille dans le POC).  
- Une seule interface : RAG + Bibliographie (veille) + gestion des documents.

---

## 8. Flows d’usage

### 8.1 Flow « Recherche RAG »

1. Utilisateur **connecté** accède à la section **RAG**.  
2. Saisit une **requête** (naturelle ou critères).  
3. Système : **filtres métadonnées** (optionnel) → **FTS + recherche vectorielle** → **fusion (RRF)** → (optionnel) **rerank** → sélection du **contexte** (chunks).  
4. **LLM** génère une réponse à partir du contexte.  
5. **Réponse sourcée** : citations (document, section, page si dispo) + **lien vers le PDF** (Storage).  
6. Utilisateur consulte la réponse et peut ouvrir le PDF original.

### 8.2 Flow « Veille / Bibliographie »

1. **Job** (cron ou manuel) : récupère la **liste des sources** depuis Supabase.  
2. **Scraping HTML** : pour chaque source, extraction **titre, abstract, URL** (et métadonnées si dispo).  
3. **Déduplication** (DOI / titre).  
4. **Embedding** des abstracts → **score de similarité** vs corpus (ou index abstracts).  
5. **Enregistrement** des items (veille_runs, veille_items) avec score.  
6. Utilisateur **connecté** accède à la section **Bibliographie** : voit une **liste rankée** avec URL de la page, abstract, score.  
7. Utilisateur clique sur l’URL pour lire l’article sur la source.

### 8.3 Flow « Ajout de documents (upload) »

1. Utilisateur **connecté** (chercheur / user autorisé) accède à **Documents**.  
2. **Upload** d’un ou plusieurs PDFs (front → API).  
3. API : envoi du fichier vers **Supabase Storage** + création de l’enregistrement **document** (métadonnées).  
4. **Ingestion** (synchrone ou asynchrone) : **parsing PDF** (texte + fallback OCR) → **chunking** (scientifique) → **embeddings** → écriture **chunks** (FTS + pgvector).  
5. Le document devient **searchable** dans le RAG.

### 8.4 Flow « Incrémentation RAG par la veille » (à terme)

1. Depuis la **liste veille**, l’utilisateur marque un article comme « à ajouter au corpus ».  
2. Si un **lien PDF** est disponible (scraping ou manuel), le système peut proposer le téléchargement puis l’**upload** → même pipeline qu’en 8.3.  
3. Sinon : l’utilisateur récupère le PDF lui-même et l’upload via **Documents**.

---

## 9. Questions ouvertes (pour le cadrage et le mémoire)

### A. Scoring et priorisation

- Souhaite-t-il un **seuil de pertinence automatique** (ex. top 10 % uniquement) ?  
- Pondération **manuelle** des critères (auteur, laboratoire, thématique) ?

### B. Interaction avec le RAG

- Réponses **sourcées** avec citations exactes ? **Comparaison** explicite entre plusieurs articles ?  
- Usage plutôt **exploration libre** ou **réponse à des hypothèses précises** ?

### C. Temporalité de la veille

- **Notification proactive** ou **tableau de bord hebdomadaire** ?  
- Importance **fraîcheur vs pertinence** ?

### D. Mesure de la valeur apportée

- Indicateurs : **temps économisé**, **taux d’articles lus**, **qualité perçue** de la veille.  
- **Boucle de feedback** (labels, retours) pour améliorer le scoring / le RAG ?

---

## 10. Positionnement méthodologique (mémoire)

Le projet peut être positionné comme :

- **Augmentation du chercheur** (outil d’aide à la décision), pas un remplacement.  
- **Valorisation d’un capital scientifique dormant** (20 ans de littérature).  
- **Cas concret d’IA explicable** appliquée à la recherche fondamentale (sources, critères, traçabilité).

---

## 11. Références internes

| Document | Contenu |
|----------|---------|
| **STRUCTURE_ET_ARCHITECTURE.md** | Architecture technique, modèle de données, structure des dossiers, flux techniques. |
| **RAG_REFERENCE.md** | Module RAG : stockage PDF (data/pdfs/), ingestion, recherche, génération, UX. |
| **INGESTION_EMBEDDING.md** | Paramètres et flow d’ingestion/embedding (chunking, modèle 384D, sections). |
| **AVANT_EXTRACTION.md** | Points à surveiller avant une extraction massive (migrations, env, volume). |
| **PIPELINE_VEILLE.md** | Pipeline veille détaillée : étapes, décisions, garde-fous, similarité vs DB vectorielle. |
| **HISTORIQUE_DECISIONS.md** | Historique des choix (centralisation, veille, upload, etc.). |
| **STACK_REFERENCE.md** | Flow technique détaillé et tableaux d’outils (Local First / Cloud First) pour le mémoire. |
