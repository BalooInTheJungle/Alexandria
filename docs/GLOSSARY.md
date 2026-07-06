# GLOSSARY — Termes métier Alexandria

Bilingue FR/EN. Termes scientifiques, techniques, et propres au projet.

---

## Termes techniques du projet

| Terme | EN équivalent | Définition |
|-------|---------------|------------|
| **Chunk** | Chunk | Fragment de texte extrait d'un article PDF. Unité de base du RAG. Deux tailles coexistent selon le chemin d'ingestion : ~600 **caractères** (pas tokens), overlap 100, par section, pour l'ingestion bulk Python (`scripts/ingest.py`) ; ~400 caractères, overlap 50, par paragraphe, pour l'upload API (`lib/ingestion/chunk.ts`, corpus direct ou module Analyse). |
| **Embedding** | Embedding / vector | Représentation numérique d'un texte sous forme de vecteur (ici 384 dimensions). Deux textes sémantiquement proches ont des vecteurs proches. |
| **Ingestion** | Ingestion | Processus complet de traitement d'un PDF : lecture → découpage en chunks → calcul des embeddings → insertion en base. |
| **Veille** | Literature watch / monitoring | Surveillance automatique des nouvelles publications dans les journaux scientifiques ciblés. |
| **Run (veille)** | Run | Une exécution quotidienne de la pipeline de veille (4 jobs GitHub Actions) : extraction RSS/OpenAlex/CrossRef de toutes les sources actives + scoring des articles trouvés + analyse IA. Pas de scraping HTML — extraction structurée par flux RSS et API. |
| **Score / similarity_score** | Similarity score | Mesure de proximité sémantique entre l'abstract d'un nouvel article et le corpus existant (cosinus entre vecteurs, entre 0 et 1). Plus le score est élevé, plus l'article est pertinent. |
| **Garde-fou** | Guardrail | Mécanisme qui bloque l'appel au LLM si la meilleure similarité trouvée est trop faible. Évite les réponses hallucinations sur des questions hors domaine. |
| **RRF** | Reciprocal Rank Fusion | Algorithme de fusion de deux listes de résultats (FTS + vectorielle). Combine les rangs plutôt que les scores pour éviter les biais d'échelle. |
| **FTS** | Full-Text Search | Recherche lexicale basée sur les mots-clés. Plus précise que le vecteur pour les termes exacts (noms propres, acronymes). Utilise `tsvector` dans Postgres. |
| **RAG** | Retrieval-Augmented Generation | Architecture IA : recherche d'extraits pertinents dans une base (retrieval) puis génération d'une réponse par LLM à partir de ces extraits (augmented generation). Évite l'hallucination en ancrant la réponse dans des sources réelles. |
| **LLM** | Large Language Model | Modèle de langage large. Ici : `gpt-4o-mini` d'OpenAI pour la génération des réponses RAG. |
| **SSE** | Server-Sent Events | Protocole HTTP qui permet d'envoyer des données en continu depuis le serveur vers le client. Utilisé pour le streaming des réponses RAG (le texte s'affiche progressivement). |
| **rag_settings** | RAG settings | Table Supabase contenant les paramètres dynamiques du RAG : seuil de garde-fou, nombre de chunks, poids FTS/vector, etc. Relus à chaque requête. |
| **Conversations / Messages** | Conversations / Messages | Historique des sessions de chat. Une conversation = N messages (alternance user/assistant). Conservés 30 jours. |
| **Analyse (module)** | Analysis | Module d'upload PDF individuel (`/analyse`) : résumé structuré, proximité corpus, discussion IA, références citées, recommandations Semantic Scholar. Distinct de l'ingestion bulk du corpus. |
| **is_temp** | is_temp | Colonne booléenne sur `chunks` : `true` = chunk issu d'une analyse **pas encore intégrée** au corpus permanent. Exclu du scoring (`match_chunks`) et de la veille. |
| **Intégration (corpus)** | Corpus integration | Action de rendre permanents les chunks d'une analyse (`is_temp` → `false`), via le bouton "Intégrer au corpus". |
| **author_score** | Author score | Score de similarité calculé uniquement contre les articles **publiés par le chercheur** (`documents.is_author_article=true`), en complément de `similarity_score` (vs corpus complet). |
| **Semantic Scholar (recs)** | Semantic Scholar recommendations | Source de veille optionnelle (Job 1b) proposant des articles récents similaires aux publications représentatives du chercheur (`ss_representative_papers`). |

---

## Termes scientifiques (domaine)

| Terme FR | Term EN | Domaine |
|----------|---------|---------|
| **Matériaux moléculaires** | Molecular materials | Matériaux dont les propriétés proviennent de leur structure moléculaire |
| **Magnétisme** | Magnetism | Étude des propriétés magnétiques de la matière |
| **Aimant moléculaire** | Single-molecule magnet (SMM) | Molécule qui présente des propriétés magnétiques sans réseau cristallin |
| **Aimant à chaîne unique** | Single-chain magnet (SCM) | Chaîne de molécules magnétiques couplées |
| **Transition de spin** | Spin crossover / spin transition | Changement d'état de spin d'un métal sous l'effet de température, pression ou lumière |
| **DOI** | DOI (Digital Object Identifier) | Identifiant unique permanent d'un article scientifique (ex. `10.1021/jacs.3c12345`) |
| **Abstract** | Abstract | Résumé d'un article scientifique (quelques lignes à un paragraphe) |
| **Résumé** | Abstract | Voir Abstract |
| **Préprint** | Preprint | Version d'un article avant évaluation par les pairs (ex. arXiv) |
| **Impact factor** | Impact factor | Indicateur bibliométrique du prestige d'une revue. Non utilisé dans Alexandria (articles lus le jour de leur publication) |
| **ISSN** | ISSN | Identifiant international d'une revue scientifique |
| **OpenAlex** | OpenAlex | Base de données bibliographique ouverte avec API (~200M articles) |

---

## Sources scientifiques utilisées (veille)

| Éditeur | Sources principales |
|---------|---------------------|
| **ACS** (American Chemical Society) | JACS, Inorganic Chemistry, Crystal Growth & Design, Chem. Mater., ACS Nano… |
| **RSC** (Royal Society of Chemistry) | Dalton Trans., Chem. Comm., PCCP, New J. Chem., CrystEngComm… |
| **Wiley** | Angew. Chemie, Chem. Eur. J., Eur. J. Inorg. Chem., ChemPhysChem… |
| **Nature** | Nature Chemistry, Nature Communications, npj Quantum Materials… |
| **Elsevier** | Inorganica Chimica Acta, Polyhedron, Coord. Chem. Reviews… |
| **APS** | Physical Review B, Physical Review Letters |
| **MDPI** | Magnetochemistry, Inorganics (les 2 seules sources MDPI réellement configurées en base — "Molecules"/"Materials" cités auparavant ne correspondent à aucune source active) |

---

## Acronymes techniques

| Acronyme | Signification |
|----------|---------------|
| **RAG** | Retrieval-Augmented Generation |
| **FTS** | Full-Text Search |
| **RRF** | Reciprocal Rank Fusion |
| **SSE** | Server-Sent Events |
| **RLS** | Row Level Security (Supabase) |
| **HNSW** | Hierarchical Navigable Small World — index pgvector créé par les migrations d'origine, **abandonné en production** (timeouts sur INSERT en masse, voir `docs/DECISIONS.md` D12) |
| **IVFFlat** | Index pgvector **réellement utilisé en production** sur `chunks.embedding` (`lists=100`) — ne se recalcule pas à l'INSERT, mais nécessite un rebuild manuel après chaque ingestion bulk |
| **GIN** | Generalized Inverted Index (index Postgres pour la FTS) |
| **OCR** | Optical Character Recognition (reconnaissance optique de caractères, pour PDFs scannés) |
| **DOI** | Digital Object Identifier |
| **ISSN** | International Standard Serial Number |
| **RSS** | Really Simple Syndication (flux d'actualités des journaux) |
