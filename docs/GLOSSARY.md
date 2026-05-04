# GLOSSARY — Termes métier Alexandria

Bilingue FR/EN. Termes scientifiques, techniques, et propres au projet.

---

## Termes techniques du projet

| Terme | EN équivalent | Définition |
|-------|---------------|------------|
| **Chunk** | Chunk | Fragment de texte extrait d'un article PDF. Unité de base du RAG (~600 tokens, overlap 100). Un article est découpé en N chunks par section (Abstract, Introduction, Methods…). |
| **Embedding** | Embedding / vector | Représentation numérique d'un texte sous forme de vecteur (ici 384 dimensions). Deux textes sémantiquement proches ont des vecteurs proches. |
| **Ingestion** | Ingestion | Processus complet de traitement d'un PDF : lecture → découpage en chunks → calcul des embeddings → insertion en base. |
| **Veille** | Literature watch / monitoring | Surveillance automatique des nouvelles publications dans les journaux scientifiques ciblés. |
| **Run (veille)** | Run | Une exécution de la pipeline de veille : scraping de toutes les sources + scoring des articles trouvés. |
| **Score / similarity_score** | Similarity score | Mesure de proximité sémantique entre l'abstract d'un nouvel article et le corpus existant (cosinus entre vecteurs, entre 0 et 1). Plus le score est élevé, plus l'article est pertinent. |
| **Garde-fou** | Guardrail | Mécanisme qui bloque l'appel au LLM si la meilleure similarité trouvée est trop faible. Évite les réponses hallucinations sur des questions hors domaine. |
| **RRF** | Reciprocal Rank Fusion | Algorithme de fusion de deux listes de résultats (FTS + vectorielle). Combine les rangs plutôt que les scores pour éviter les biais d'échelle. |
| **FTS** | Full-Text Search | Recherche lexicale basée sur les mots-clés. Plus précise que le vecteur pour les termes exacts (noms propres, acronymes). Utilise `tsvector` dans Postgres. |
| **RAG** | Retrieval-Augmented Generation | Architecture IA : recherche d'extraits pertinents dans une base (retrieval) puis génération d'une réponse par LLM à partir de ces extraits (augmented generation). Évite l'hallucination en ancrant la réponse dans des sources réelles. |
| **LLM** | Large Language Model | Modèle de langage large. Ici : `gpt-4o-mini` d'OpenAI pour la génération des réponses RAG. |
| **SSE** | Server-Sent Events | Protocole HTTP qui permet d'envoyer des données en continu depuis le serveur vers le client. Utilisé pour le streaming des réponses RAG (le texte s'affiche progressivement). |
| **rag_settings** | RAG settings | Table Supabase contenant les paramètres dynamiques du RAG : seuil de garde-fou, nombre de chunks, poids FTS/vector, etc. Relus à chaque requête. |
| **Conversations / Messages** | Conversations / Messages | Historique des sessions de chat. Une conversation = N messages (alternance user/assistant). Conservés 30 jours. |

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
| **MDPI** | Magnetochemistry, Molecules, Materials |

---

## Acronymes techniques

| Acronyme | Signification |
|----------|---------------|
| **RAG** | Retrieval-Augmented Generation |
| **FTS** | Full-Text Search |
| **RRF** | Reciprocal Rank Fusion |
| **SSE** | Server-Sent Events |
| **RLS** | Row Level Security (Supabase) |
| **HNSW** | Hierarchical Navigable Small World (index pgvector pour la recherche vectorielle rapide) |
| **GIN** | Generalized Inverted Index (index Postgres pour la FTS) |
| **OCR** | Optical Character Recognition (reconnaissance optique de caractères, pour PDFs scannés) |
| **DOI** | Digital Object Identifier |
| **ISSN** | International Standard Serial Number |
| **RSS** | Really Simple Syndication (flux d'actualités des journaux) |
