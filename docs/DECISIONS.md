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

## Template pour de nouvelles décisions

```
## D[n] — Titre court

**Décision** : ce qui a été décidé
**Raison** : pourquoi ce choix
**Alternative écartée** : ce qui a été envisagé et rejeté, et pourquoi
**Conséquence** : impact sur le développement futur
```
