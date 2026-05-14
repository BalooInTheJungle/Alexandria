# DECISIONS — Décisions techniques Alexandria

Registre des décisions importantes : pourquoi tel choix, quelles alternatives écartées.
Ne pas revenir sur ces décisions sans bonne raison et mise à jour de ce fichier.

---

## D1 — Cloud uniquement, pas d'on-prem

**Décision** : tout sur cloud (Supabase + Vercel). Pas de migration vers serveur local à terme.
**Raison** : contraintes institutionnelles CNRS + simplicité de maintenance pour un chercheur.
**Alternative écartée** : Ollama local / serveur on-prem → trop complexe à opérer.

---

## D2 — Embeddings locaux (pas d'API payante)

**Décision** : `@xenova/transformers` côté Node + `sentence-transformers` Python, modèle `all-MiniLM-L6-v2`, 384D.
**Raison** : même modèle côté ingestion et côté requête → cohérence des vecteurs. Aucun coût API pour les embeddings.
**Contrainte** : dimension `vector(384)` figée en base. Tout changement de modèle nécessite une réingestion complète.
**Alternative écartée** : OpenAI `text-embedding-ada-002` (1536D) → coût par requête, dépendance externe.

---

## D3 — Recherche hybride FTS + vector + RRF

**Décision** : fusionner recherche vectorielle (cosinus, pgvector) et lexicale (FTS, tsvector) via RRF.
**Raison** : les deux approches sont complémentaires. La FTS capture les termes exacts (noms propres, acronymes scientifiques). Le vector capture la sémantique. RRF est robuste et paramétrable.
**Paramètres** : `fts_weight`, `vector_weight`, `rrf_k`, `hybrid_top_k` stockés dans `rag_settings` → ajustables sans redéploiement.

---

## D4 — Bilingue FR/EN avec colonnes séparées

**Décision** : deux jeux de colonnes dans `chunks` : `(content, embedding, content_tsv)` pour l'anglais et `(content_fr, embedding_fr, content_fr_tsv)` pour le français.
**Raison** : les modèles d'embedding et les configurations FTS sont différents selon la langue. Un seul jeu de colonnes avec détection automatique serait moins précis.
**Coût** : ~2x l'espace de stockage pour les chunks + temps d'ingestion plus long (traduction MarianMT).

---

## D5 — Ingestion PDF en Python (pas en Node)

**Décision** : script Python séparé `scripts/ingest.py` pour l'ingestion des PDFs.
**Raison** : `PyMuPDF` + `sentence-transformers` + `MarianMT` sont des bibliothèques Python matures. Pas d'équivalent aussi performant en Node.
**Conséquence** : l'ingestion n'est pas entièrement dans le flux Next.js. Upload via l'UI → stockage fichier → l'ingestion Node appelle un pipeline JS ou réutilise le script Python.
**À surveiller** : la route `/api/ingestion` côté Node doit rester cohérente avec le script Python (même modèle, même dimension).

---

## D6 — rag_settings en base de données

**Décision** : tous les paramètres du RAG (seuils, poids, nombre de chunks, message garde-fou) sont stockés dans la table `rag_settings`, relus à chaque requête.
**Raison** : permet d'ajuster les paramètres en production sans redéploiement. Le chercheur peut fine-tuner le comportement depuis l'UI d'admin.
**Contrainte** : chaque requête RAG fait une lecture Supabase supplémentaire pour `rag_settings`. Acceptable car les valeurs sont petites.

---

## D7 — Veille : HTML scraping via RSS + OpenAlex (pas Playwright)

**Décision** : flux RSS pour les 43 journaux principaux + API OpenAlex pour les sources sans RSS.
**Raison** : RSS est le format natif des journaux scientifiques, léger et fiable. OpenAlex est une API publique robuste avec 200M+ articles.
**Alternative écartée** : Playwright/scraping HTML → fragile (changements CSS), lent, bloqué par anti-bots.
**Limite** : certains éditeurs (ACS) ne mettent pas l'abstract dans le RSS → enrichissement OpenAlex en batch.

---

## D8 — Une seule app Next.js (RAG + Veille + Documents)

**Décision** : tout dans une seule application, une seule base Supabase.
**Raison** : le chercheur est le seul utilisateur principal. La complexité d'une architecture micro-services n'est pas justifiée.
**Avantage** : un seul déploiement Vercel, une seule base, partage naturel des données entre RAG et veille.

---

## D9 — Stockage PDFs en local (data/pdfs/) en POC

**Décision** : les PDFs sont stockés dans `data/pdfs/` (fichiers locaux au projet) pendant le POC.
**Raison** : simplicité pour commencer. Le script Python lit directement depuis ce dossier.
**À terme** : migration vers Supabase Storage pour les ~100 Go de PDFs (quand le volume le justifie).
**Conséquence** : `data/pdfs/` est dans `.gitignore` et `.claudeignore` — ne jamais committer.

---

## D10 — RLS activé sur toutes les tables

**Décision** : Row Level Security activé sur toutes les tables Supabase.
**Raison** : sécurité par défaut. Même si un utilisateur obtient la clé anon, il ne peut accéder qu'aux données autorisées par sa session.
**Conséquence** : toujours utiliser `lib/supabase/server.ts` pour les routes API standard. Uniquement `lib/supabase/admin.ts` (service role) pour les crons et l'ingestion.

---

## D11 — Pas de traduction EN→FR pour l'ingestion bulk

**Décision** : lors de l'ingestion bulk des 15 477 PDFs, `content_fr = content` (EN) et `embedding_fr = embedding` (EN). Pas d'appel MarianMT.
**Raison** : MarianMT multiplie le temps d'ingestion par 3-4x. Pour ~15k PDFs, c'est prohibitif. La recherche FR fonctionnera moins bien mais le corpus est majoritairement en anglais de toute façon.
**Conséquence** : la recherche hybride FR donnera des résultats moins précis que si la traduction était faite. À réévaluer si un usage FR intensif est confirmé.
**Alternative écartée** : traduction MarianMT → trop lente (> 24h estimées pour 15k docs).

---

## D12 — Drop des index HNSW avant ingestion bulk

**Décision** : avant toute ingestion bulk (> 100 documents), dropper les index HNSW sur `chunks.embedding` et `chunks.embedding_fr`, puis les recréer après.
**Raison** : chaque INSERT dans une table avec index HNSW déclenche une mise à jour du graphe de voisinage. Avec m=16 et ef_construction=64, ce surcoût dépasse le timeout statement Supabase (30s) dès que plusieurs chunks sont insérés en parallèle.
**Procédure** :
```sql
-- Avant ingestion
DROP INDEX IF EXISTS idx_chunks_embedding;
DROP INDEX IF EXISTS idx_chunks_embedding_fr;

-- Après ingestion
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX idx_chunks_embedding_fr ON chunks USING hnsw (embedding_fr vector_cosine_ops) WITH (m=16, ef_construction=64);
```
**Conséquence** : pendant l'ingestion, la recherche vectorielle est plus lente (scan séquentiel). Acceptable car l'ingestion se fait en dehors des heures d'usage.

---

## D13 — Supabase Pro pour le stockage PDFs

**Décision** : passage au plan Supabase Pro (25$/mois) pour supporter le volume de PDFs.
**Raison** : le corpus 2015-2026 = ~7,4 Go de PDFs + embeddings pgvector. Le plan Free (500 MB DB) est insuffisant.
**Détail stockage** :
- 2000-2026 : ~13 Go → hors budget plan Pro (8 Go DB)
- 2015-2026 : ~7,4 Go → compatible plan Pro
- Choix retenu : **2015-2026 uniquement** (~15 477 PDFs)
**À surveiller** : taille de la table `chunks` avec ~500k vecteurs 384D ≈ 750 MB supplémentaires.

---

## D14 — Architecture ingestion : batch=5, retry 3x, pause 0.3s

**Décision** : le script `scripts/ingest.py` insère par batch de 5 chunks avec 3 tentatives (backoff exponentiel) et 0.3s de pause entre batches.
**Raison** : les timeouts Supabase sont inévitables avec l'index HNSW actif. Le retry permet de ne pas crasher. Le batch petit réduit la probabilité de timeout.
**Note** : cette décision est temporaire — avec le drop HNSW (D12), on pourra passer à batch=50 sans problème.

---

## Template pour de nouvelles décisions

```
## D[n] — Titre court

**Décision** : ce qui a été décidé
**Raison** : pourquoi ce choix
**Alternative écartée** : ce qui a été envisagé et rejeté, et pourquoi
**Conséquence** : impact sur le développement futur
```
