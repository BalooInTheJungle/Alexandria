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

## D12 — Index IVFFlat (pas HNSW) pour `chunks.embedding`

**Décision** : utiliser **IVFFlat** (lists=100) sur `chunks.embedding`, pas HNSW.
**Raison** : HNSW cause des timeouts (57014) à chaque INSERT car il recalcule le graphe de voisinage. Avec ~15k PDFs à ingérer et des inserts en batch, HNSW est prohibitif. IVFFlat ne se met pas à jour à l'INSERT → aucun timeout d'ingestion.
**Contrepartie** : l'index IVFFlat se dégrade si de nombreux chunks sont insérés sans rebuild. Procédure : reconstruire avec `CREATE INDEX CONCURRENTLY` après chaque ingestion bulk (> 50k chunks). Durée : 5-15 min.
**Procédure de rebuild** :
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_chunks_embedding;
CREATE INDEX CONCURRENTLY idx_chunks_embedding
  ON public.chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```
**Note** : `ingest.py` crée l'index IVFFlat automatiquement via psycopg2 à la fin de chaque run d'ingestion.
**Conséquence** : pendant l'ingestion (avant rebuild), la recherche vectorielle est plus lente. Acceptable car l'ingestion se fait hors des heures d'usage.
**Alternative écartée** : HNSW (m=16, ef_construction=64) → timeouts garantis sur ingestion bulk, même avec batch=5.

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

## D15 — Correction rétroactive du texte espacé dans les chunks

**Décision** : lancer `scripts/fix_spaced_chunks.py --apply` pour corriger le contenu et re-générer les embeddings de tous les chunks avec texte espacé.
**Constat** : 797 379 chunks sur 848 857 (94%) avaient leur `content` encodé avec des espaces entre chaque caractère (`D   C       m   a   g   n   e   t   i   z   a   t   i   o   n`). Cause : PyMuPDF + certains encodages PDF anciens. L'embedding de `"D   C   ..."` est différent de l'embedding de `"DC magnetization..."` → qualité sémantique dégradée.
**Solution** :
1. Détection SQL : `content ~ '([A-Za-z] {2,4}){10,}'` (rapide, ne scanne pas en Python)
2. Fix Python : `fix_spaced_text()` — supprime les espaces inter-caractères, reconstruit les mots
3. Re-embed avec `all-MiniLM-L6-v2`
4. UPDATE `chunks.content` + `chunks.embedding` — trigger met à jour `content_tsv` automatiquement
5. Rebuild IVFFlat après (embeddings changés)
**Résultat** : 797 379 chunks corrigés, 0 erreur. Qualité sémantique RAG et comparaison articles auteur améliorée.
**Script** : `scripts/fix_spaced_chunks.py` (options `--dry-run`, `--apply`, `--limit`, `--author-only`)
**À refaire si** : nouvelle ingestion bulk de PDFs anciens (vérifier avec `--dry-run` d'abord).

---

## D16 — Embedding moyen pour comparer les articles auteur au corpus

**Décision** : la route `/api/corpus/author-articles/[id]/similar` utilise la **moyenne de tous les embeddings** des chunks d'un article auteur comme vecteur requête, pas le chunk en position=0.
**Raison** : `position=0` est souvent le header ou la page de garde du PDF — pour les vieux articles, c'est du texte espacé ou des métadonnées. L'embedding de ce chunk est non représentatif du contenu scientifique.
La moyenne de tous les embeddings capture la sémantique globale de l'article (méthodes, résultats, discussion).
**Impact observé** : avant la correction, "Furor over quantum computing" (98%) apparaissait comme similaire à un article sur les polyoxomolybdènes. Après : résultats cohérents (coordination chemistry, spin crossover, complexes de métaux de transition).
**Implémentation** : `averageEmbeddings()` dans `app/api/corpus/author-articles/[id]/similar/route.ts`.
**Coût** : légèrement plus lent (~3-4s au lieu de ~2s) — on charge tous les chunks de l'article (~163 chunks en moyenne).

---

## Template pour de nouvelles décisions

```
## D[n] — Titre court

**Décision** : ce qui a été décidé
**Raison** : pourquoi ce choix
**Alternative écartée** : ce qui a été envisagé et rejeté, et pourquoi
**Conséquence** : impact sur le développement futur
```
