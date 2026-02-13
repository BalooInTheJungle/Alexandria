# Structure et architecture du projet Alexandria

**Objectif** : document de référence pour valider l’architecture et la structure des dossiers avant implémentation.

---

## 1. Rappel des besoins et décisions (historique)

| Sujet | Décision |
|-------|----------|
| **Centralisation** | Une seule interface front : RAG + pertinence bibliographie. Tout sur la même base Supabase. À terme : articles de la veille peuvent alimenter le RAG (incrémentation). |
| **Veille** | HTML scraping uniquement. Liste des sources (liens) récupérée depuis Supabase. Sortie : liste rankée sur le front avec URL de la page. Similarité : sur l’**abstract** uniquement (pas le texte complet). |
| **Utilisateurs** | Au moins deux profils (toi + un autre user). Login requis. Documents scientifiques accessibles uniquement à certaines personnes → **upload manuel** des PDFs depuis le front par le prof/user. Pas d’ingestion automatique de PDFs depuis la veille dans le POC (à terme possible). |
| **Stack** | Next.js (TS), Supabase (Postgres + pgvector + Storage), recherche hybride FTS + vectoriel, LLM/embeddings (Ollama si possible). |

---

## 2. Architecture logique (centralisée)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRONT NEXT.JS (une seule app)                     │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐ │
│  │ Recherche RAG        │  │ Bibliographie /     │  │ Auth / Profil   │ │
│  │ (requête, réponses   │  │ Veille (liste       │  │ (login)         │ │
│  │  sourcées, PDF)      │  │  rankée, URLs)      │  │                 │ │
│  └──────────┬───────────┘  └──────────┬──────────┘  └────────┬────────┘ │
└─────────────┼─────────────────────────┼─────────────────────┼──────────┘
              │                         │                     │
              ▼                         ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    API ROUTES / SERVER ACTIONS (Next)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ RAG: search  │  │ Veille:      │  │ Ingestion:   │  │ Auth         │  │
│  │ hybrid +     │  │ scrape +     │  │ upload PDF,  │  │ (Supabase    │  │
│  │ rerank + LLM │  │ score vs     │  │ parse,       │  │  Auth)       │  │
│  │ + citations  │  │ corpus       │  │ chunk, embed │  │              │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
└─────────┼─────────────────┼─────────────────┼─────────────────┼──────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE                                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │
│  │ Postgres +       │  │ Storage         │  │ Auth                    │   │
│  │ pgvector         │  │ (PDFs)          │  │ (users)                 │   │
│  │ (documents,      │  │                 │  │                         │   │
│  │  chunks, sources,│  │                 │  │                         │   │
│  │  veille runs)    │  │                 │  │                         │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Une base, une app** : pas de séparation physique RAG / Veille côté code métier, mais **modules logiques** dans le même repo (voir §4).

---

## 3. Modèle de données (Supabase) — résumé

- **auth.users** : utilisateurs (Supabase Auth).
- **documents** : métadonnées PDF (titre, auteurs, DOI, journal, date, `storage_path`). PDFs stockés localement dans **data/pdfs/** ; `storage_path` = chemin relatif (ex. `data/pdfs/nom.pdf`) pour retrouver le document.
- **chunks** : texte + embedding (pgvector) + `document_id`, position, page.
- **sources** : liste des sources de veille (URL, nom, config) — déjà en place côté Supabase.
- **veille_runs** : une exécution de scrape (date, statut).
- **veille_items** : un article récupéré par run (titre, abstract, url, `similarity_score` vs corpus, `source_id`, `run_id`).
- **Index** : GIN FTS sur `chunks`, index vectoriel sur `chunks.embedding`.

Détail des champs et relations à figer en phase suivante (schéma SQL dans un autre doc si tu veux).

---

## 4. Proposition de structure des dossiers (à valider)

Structure **centralisée** dans un seul repo Next.js, avec séparation claire RAG / Veille / Shared.

```
alexandria/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Groupe : login, signup, redirect
│   │   ├── login/
│   │   └── ...
│   ├── (dashboard)/              # Groupe : tout le reste (protégé)
│   │   ├── layout.tsx            # Layout avec nav : RAG | Bibliographie (2 pages distinctes)
│   │   ├── page.tsx              # Accueil ou redirection
│   │   ├── rag/                  # Page 1 : RAG uniquement
│   │   │   └── page.tsx          # Interface recherche RAG + résultats + citations
│   │   └── bibliographie/        # Page 2 : Veille + Documents (tout côté « bibliographie »)
│   │       ├── page.tsx          # Liste veille rankée (abstract, score, URL)
│   │       └── documents/        # Upload + liste des PDFs (prof/user) — dans la section Bibliographie
│   │           └── page.tsx
│   ├── api/                      # API routes
│   │   ├── rag/
│   │   │   ├── search/           # Recherche hybride + rerank + context
│   │   │   └── chat/             # Génération RAG + citations (si séparé)
│   │   ├── veille/
│   │   │   ├── scrape/           # Déclencher pipeline veille (cron ou manuel)
│   │   │   └── list/             # Lister items rankés (sources depuis Supabase)
│   │   ├── documents/
│   │   │   └── upload/           # Upload PDF → Storage + création document (section Bibliographie)
│   │   └── ingestion/            # Post-upload : parse, chunk, embed — à détailler plus tard
│   ├── layout.tsx
│   └── globals.css
│
├── lib/                          # Logique partagée
│   ├── supabase/
│   │   ├── client.ts             # Client navigateur
│   │   ├── server.ts             # Client serveur
│   │   └── admin.ts              # Si besoin (service role)
│   ├── db/                       # Accès données (requêtes, types)
│   │   ├── documents.ts
│   │   ├── chunks.ts
│   │   ├── sources.ts
│   │   ├── veille.ts
│   │   └── types.ts
│   ├── rag/                      # Pipeline RAG
│   │   ├── detect-lang.ts        # Détection heuristique FR/EN (requête)
│   │   ├── search.ts             # FTS + vector + RRF ; selon lang → match_chunks(_fr) + search_chunks_fts(_fr)
│   │   ├── embed.ts              # Embeddings 384D (Xenova/all-MiniLM-L6-v2)
│   │   ├── openai.ts             # Génération LLM + instruction langue (FR/EN)
│   │   ├── citations.ts         # Format réponses sourcées
│   │   └── settings.ts           # Lecture rag_settings
│   ├── veille/                    # Pipeline veille (sources 100 % en DB, pas de config fichier)
│   │   ├── sources.ts            # Récup liste sources depuis Supabase
│   │   ├── fetch-source-pages.ts # Récup HTML/XML des pages sources (fetch HTTP uniquement)
│   │   ├── extract-urls.ts       # RSS/Atom/RDF → parse XML ; HTML → parse (cheerio) → URLs candidates
│   │   ├── detect-bot-challenge.ts # Détection page anti-bot (0 URL, titre type « Client Challenge ») → log suggestion RSS
│   │   ├── guardrails.ts         # Dédup DOI vs DB ; pré-filtre URLs avant LLM ; rate limit, quotas
│   │   ├── filter-urls-llm.ts    # LLM : ne garder que les URLs de pages articles (après guardrails)
│   │   ├── extract-article-llm.ts# Pré-nettoyage bloc article (trafilatura) → LLM : titre, auteurs, DOI, abstract, date (schéma fixe)
│   │   └── score.ts              # Similarité abstract vs DB vectorielle (embedding vs corpus)
│   ├── ingestion/
│   │   ├── parse-pdf.ts          # Extraction texte (+ fallback OCR)
│   │   ├── chunk.ts              # Chunking scientifique
│   │   └── index.ts              # Orchestration : parse → chunk → embed → insert
│   └── auth/
│       └── middleware.ts         # Vérif session (ou dans middleware Next)
│
├── components/
│   ├── ui/                       # Composants génériques (boutons, inputs, etc.)
│   ├── rag/                      # Recherche, résultats, citations, lien PDF
│   ├── bibliographie/            # Liste veille, carte article, URL ; upload/liste documents
│   └── layout/                   # Nav, sidebar, header
│
├── data/                             # Données locales (hors Git : voir .gitignore)
│   ├── README.md                     # Rôle des dossiers
│   └── pdfs/                          # Dépôt des PDF à indexer pour le RAG
│       └── .gitkeep                  # (fichiers *.pdf non versionnés)
│
├── documentation/
│   ├── STRUCTURE_ET_ARCHITECTURE.md   # Ce fichier
│   ├── VEILLE.md                     # Veille : flux, stratégies RSS/HTML, garde-fous, tests
│   ├── BACK_RAG.md                    # Back RAG (ingestion, recherche, génération, paramètres)
│   └── HISTORIQUE_DECISIONS.md        # Synthèse des choix
│
├── public/
├── supabase/                     # Config locale / migrations (optionnel)
│   └── migrations/
├── .env.local                    # SUPABASE_URL, KEY, etc.
├── next.config.js
├── package.json
└── tsconfig.json
```

**Points validés :**

- **Deux pages distinctes** : **RAG** (une page) et **Bibliographie / Veille** (une page) ; même layout, nav commune (RAG | Bibliographie).
- **Documents** : gestion des PDFs (upload + liste) se trouve **dans la section Bibliographie** (`bibliographie/documents/`), pas en page racine.
- **Veille** : **aucun fichier de config sources** ; tout est en base (Supabase). Liste des sources lue depuis la DB.
- **Ingestion** (parse → chunk → embed après upload) : à détailler et implémenter plus tard.

---

## 4.1 Pipeline Veille (stratégie de scraping intelligent)

Objectif : une pipeline **cohérente, stable et performante**, avec garde-fous pour ne pas surcharger (LLM, dédup, volume).

### Étapes prévues

1. **Récupération des pages sources**  
   URLs des sources récupérées depuis la DB → fetch HTML des pages (pas de config en dur).

2. **Nettoyage HTML → extraction d’URLs**  
   Nettoyer le code HTML pour extraire **uniquement les URLs** ; cibler en priorité les URLs susceptibles d’être des **pages d’article** (filtres heuristiques si besoin).

3. **Filtrage des URLs par LLM**  
   Envoyer la liste d’URLs candidates au LLM → le LLM ne renvoie **que les URLs de pages d’articles** (réduction du bruit, pas de surcharge avec du contenu inutile).

4. **Extraction des données article (LLM)**  
   Pour chaque URL de page article : récupérer le HTML → envoyer au LLM pour extraire **auteur(s), DOI, abstract, titre, etc.**  
   Ne pas envoyer tout le HTML : éviter le contenu sans donnée utile (menus, pubs, footer) pour ne pas surcharger le LLM.

5. **Garde-fous**  
   - Ne pas scraper ce qui est **déjà en base** (dédup par **DOI** ; s’appuyer sur la DB pour couper / filtrer le flux en amont).  
   - **Bloquer avant le LLM** : filtrage heuristique ou règles (ex. depuis la DB) pour ne pas envoyer de coûts inutiles au LLM.  
   - Limiter la charge : rate limiting, quotas ; run asynchrone (peut durer longtemps).

6. **À terme**  
   - Comparer les sources récupérées avec la **DB vectorielle** pour une **analyse de similarité** (embedding abstract vs corpus → score → liste rankée).

Sources très variées → scraping **le plus intelligent possible**, tout en maîtrisant coût et stabilité.

### Décisions Veille (validées)

| Sujet | Décision |
|-------|----------|
| **Déclenchement** | **UI** (bouton manuel) pour l’instant. Run peut durer très longtemps → prévoir **job asynchrone** (queue). |
| **Run** | **Toutes les sources d’un coup** : une run = toutes les sources (pas une run par source). |
| **Dédup** | **DOI suffit**. S’appuyer sur ce qu’on a en DB pour **couper le HTML / le flux** qu’on envoie au LLM : au trigger, les articles déjà présents (DOI en base) sont considérés comme déjà scrappés → garde-fou côté URL / DOI. |
| **Filtrage URLs** | **Bloquer avant le LLM** (règles / heuristiques depuis la DB ou par source) pour éviter coûts inutiles ; à affiner selon qualité des réponses. |
| **Extraction article** | **Bloc article seul** (pré-nettoyage type trafilatura / readability) puis envoi de ce bloc au LLM. **Schéma de sortie fixe** pour toutes les sources (ex. title, authors, doi, abstract, date). |
| **Erreurs** | **Skip + log** : en cas d’échec (timeout, 403, LLM), on skip et on log, on continue. **Logs sur la ligne en DB** suffisent (ex. champ `last_error` sur item ou run), pas de table veille_errors dédiée pour le POC. |
| **Similarité** | À terme : comparer les items récupérés avec la **DB vectorielle** pour analyse de similarité (score vs corpus → priorisation). |

---

## 5. Flux principaux (rappel)

- **RAG** : Requête → **détection langue** (fr/en) → embedding → FTS + vector (EN ou FR selon lang) → fusion RRF → context → LLM (instruction « Réponds en français » / « en anglais ») → réponses + citations + lien Storage PDF.
- **Veille** : Bouton UI → job asynchrone → lecture sources depuis Supabase → fetch HTML pages sources → nettoyage HTML → extraction URLs → **guardrails** (dédup DOI vs DB, pré-filtre URLs avant LLM) → LLM filtre URLs (pages articles uniquement) → pour chaque page article : pré-nettoyage bloc article → LLM extrait titre, auteurs, DOI, abstract, date (schéma fixe) ; skip + log en cas d’erreur → embedding abstract → **similarité vs DB vectorielle** → écriture `veille_items` (last_error si échec) → front affiche liste rankée avec URL.
- **Documents / Ingestion RAG** : PDFs déposés dans **data/pdfs/** → processus d’ingestion lancé **à la main** → lecture du dossier, parse PDF (métadonnées extraites depuis le PDF), chunking, embeddings → écriture `documents` + `chunks` en base. `storage_path` = chemin relatif vers le fichier. Recherche possible ensuite par titre, DOI, auteurs. (À terme : possibilité d’ajouter des documents via l’interface.)

---

## 6. Suite après validation

- **Structure de dossiers et fichiers squelettes** : créée (app, lib, components, api, documentation).
- **Doc Veille** : voir **VEILLE.md** (flux, stratégies, structure du code, tests).
- Prochaines étapes : schéma SQL détaillé (migrations Supabase) si besoin ; implémentation par brique : auth → documents/upload → ingestion → RAG → veille.
