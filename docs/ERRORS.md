# ERRORS — Erreurs connues et solutions

Erreurs rencontrées sur Alexandria. Ajouter une entrée à chaque erreur résolue.

---

## Template

```
### [CONTEXTE] Titre de l'erreur

**Symptôme** : ce qu'on voit (message d'erreur, comportement)
**Cause** : pourquoi ça arrive
**Solution** : ce qui a résolu le problème
**Fichier concerné** : chemin/fichier.ts
```

---

## Erreurs connues

### [VERCEL] OPENAI_API_KEY — invalid header value

**Symptôme** : `Error: Invalid header value` ou `400 Bad Request` lors des appels OpenAI en production.
**Cause** : la clé contient des caractères non-ASCII imprimables (espaces invisibles, caractères spéciaux copiés-collés).
**Solution** : sanitisation dans `lib/rag/openai.ts` — filtrer uniquement les caractères ASCII imprimables avant utilisation.
**Fichier concerné** : `lib/rag/openai.ts`

---

### [SUPABASE] embed.ts — EMBED_OPTIONS dupliqué

**Symptôme** : `SyntaxError: Identifier 'EMBED_OPTIONS' has already been declared`
**Cause** : doublon de déclaration de constante dans le fichier.
**Solution** : supprimer la déclaration dupliquée, garder une seule définition.
**Fichier concerné** : `lib/rag/embed.ts`

---

### [SUPABASE] RPC match_chunks — wrong number of arguments

**Symptôme** : `Error: function match_chunks(...) does not exist` ou mauvais résultats.
**Cause** : signature de la fonction SQL en base ne correspond pas à l'appel TypeScript.
**Solution** : vérifier la migration `20260205100001_match_chunks_rpc.sql` et s'assurer que le nombre et le type des paramètres correspondent à l'appel dans `lib/rag/search.ts`.
**Fichier concerné** : `lib/rag/search.ts`, `supabase/migrations/20260205100001_match_chunks_rpc.sql`

---

### [SUPABASE] content_tsv — violation de trigger

**Symptôme** : `Error: column content_tsv is generated` lors d'un INSERT avec `content_tsv` explicite.
**Cause** : `content_tsv` et `content_fr_tsv` sont générées automatiquement par des triggers Postgres. On ne peut pas les écrire directement.
**Solution** : retirer `content_tsv` et `content_fr_tsv` de tous les INSERT/UPDATE. Laisser les triggers travailler.
**Fichier concerné** : `lib/ingestion/index.ts`, `scripts/ingest.py`

---

### [NEXT.JS] Route API — "TypeError: body used already"

**Symptôme** : erreur sur une route API Next.js qui lit `request.body` plusieurs fois.
**Cause** : dans Next.js 14 App Router, `request.json()` ou `request.text()` ne peuvent être appelés qu'une seule fois.
**Solution** : stocker le résultat dans une variable locale et la réutiliser.
```ts
const body = await request.json()
```

---

### [NEXT.JS] Composant serveur utilise un hook React

**Symptôme** : `Error: useState/useEffect can only be used in a Client Component`
**Cause** : dans l'App Router, les composants sont serveur par défaut. Les hooks React nécessitent un composant client.
**Solution** : ajouter `'use client'` en première ligne du composant.

---

### [VERCEL] Timeout pipeline veille (Function exceeded maximum duration)

**Symptôme** : la run veille s'arrête à 10s sur Vercel.
**Cause** : durée maximale des fonctions Vercel = 10s par défaut. La pipeline veille prend > 60s.
**Solution** : `maxDuration: 300` dans le fichier route `/api/cron/veille/route.ts`.
```ts
export const maxDuration = 300
```

---

### [PYTHON] ingest.py — ModuleNotFoundError: sentence_transformers

**Symptôme** : `ModuleNotFoundError: No module named 'sentence_transformers'`
**Cause** : dépendances Python non installées.
**Solution** :
```bash
cd scripts
python3 -m pip install -r requirements.txt
```

---

### [PYTHON] ingest.py — poppler not found (pdf2image)

**Symptôme** : `PDFInfoNotInstalledError: Unable to get page count. Is poppler installed?`
**Cause** : poppler non installé sur le système.
**Solution** :
- macOS : `brew install poppler`
- Linux : `apt install poppler-utils`

---

### [SUPABASE] Auth — "Invalid JWT" en production

**Symptôme** : `Error: Invalid JWT` sur les API routes protégées.
**Cause** : utilisation du client browser dans une route serveur, ou cookie de session manquant.
**Solution** : utiliser `lib/supabase/server.ts` (et non `client.ts`) dans les routes API.

---

### [SUPABASE] RLS — "new row violates row-level security policy"

**Symptôme** : erreur d'insertion malgré un utilisateur connecté.
**Cause** : la politique RLS n'autorise pas l'opération pour ce rôle/utilisateur. Ou utilisation du mauvais client (browser au lieu de admin).
**Solution** :
- Pour les routes système (cron, ingestion) : utiliser `lib/supabase/admin.ts`
- Pour les routes utilisateur : vérifier que la politique RLS est bien définie dans `20260204100005_rls.sql`

---

### [SUPABASE] Statement timeout 57014 — INSERT chunks avec index HNSW

**Symptôme** : `ERROR: canceling statement due to statement timeout (57014)` lors de l'insertion de chunks avec embedding.
**Cause** : l'index HNSW sur `chunks.embedding` recalcule le graphe de voisinage à chaque INSERT. Ce surcoût dépasse le timeout Supabase (30s) lors d'insertions multiples.
**Solution** : l'index est maintenant **IVFFlat** (pas HNSW) — ingest.py le crée automatiquement après ingestion. Avec IVFFlat, les INSERTs ne causent pas de timeout.
**Note** : si HNSW est toujours utilisé, dropper avant ingestion bulk :
```sql
DROP INDEX IF EXISTS idx_chunks_embedding;
DROP INDEX IF EXISTS idx_chunks_embedding_fr;
-- puis recréer en IVFFlat après (voir D12 dans DECISIONS.md)
```
**Fichier concerné** : `scripts/ingest.py`, `lib/db/chunks.ts`
**Contournement temporaire** : batch=5 + retry 3x + pause 0.3s (lent mais fonctionnel).

---

### [SUPABASE] IVFFlat — dégradation des performances après ingestion bulk

**Symptôme** : les requêtes RPC `match_chunks` / `match_corpus_docs` passent de ~50ms à 16-17 secondes. Timeouts sur la route `/api/corpus/author-articles/[id]/similar`.
**Cause** : l'index IVFFlat `idx_chunks_embedding` utilise des clusters fixes calculés lors de sa création. Après l'insertion de nombreux nouveaux chunks (ex : 85k), les nouveaux vecteurs tombent dans les mauvais clusters → scan quasi-séquentiel.
**Solution** : reconstruire l'index après chaque ingestion bulk (> 50k chunks) :
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_chunks_embedding;
CREATE INDEX CONCURRENTLY idx_chunks_embedding
  ON public.chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```
Durée de reconstruction : ~5-15 minutes sur 600k chunks. `CONCURRENTLY` permet à la DB de rester opérationnelle.
**Suivi progression** :
```sql
SELECT phase, blocks_done, blocks_total,
       round(blocks_done::numeric / nullif(blocks_total,0) * 100, 1) AS pct
FROM pg_stat_progress_create_index
WHERE relid = 'public.chunks'::regclass;
```
**Fichier concerné** : `scripts/ingest.py` (crée l'index automatiquement après ingestion)

---

### [SUPABASE] Project exhausting resources — SQL Editor timeout

**Symptôme** : `Connection terminated due to connection timeout. Your project is currently exhausting multiple resources.`
**Cause** : trop de requêtes en parallèle sur Supabase (script ingest.py en boucle de retry + tentatives DROP INDEX simultanées).
**Solution** :
1. Tuer immédiatement le processus ingest.py (`kill <PID>`)
2. Attendre 5-10 minutes que Supabase se récupère
3. Relancer les commandes SQL une par une
**Prévention** : ne jamais laisser tourner ingest.py pendant qu'on manipule les index en SQL Editor.

---

### [PYTHON] ingest.py — httpx.ReadTimeout dans le handler d'erreur

**Symptôme** : le script crashe avec `httpx.ReadTimeout` à l'intérieur du bloc `except`, après un timeout initial.
**Cause** : la mise à jour du statut d'erreur en DB (appel Supabase) timeout aussi quand la base est surchargée. L'exception non gérée dans le handler crashe le script entier.
**Solution** : entourer le bloc `except` d'un `try/except` supplémentaire + `time.sleep(1)` avant la tentative d'update.
**Fichier concerné** : `scripts/ingest.py`

---

### [PYTHON] ingest.py — Null bytes dans le fichier source

**Symptôme** : `ValueError: embedded null byte` ou fichier non parseable.
**Cause** : caractère spécial dans la liste des journaux connus (copié depuis un éditeur riche).
**Solution** : ouvrir le fichier en mode binaire, remplacer `b'\x00'` par `b''`, réécrire.
**Fichier concerné** : `scripts/ingest.py`

---

### [PYTHON] ingest.py — embeddings stockés comme string JSON dans Supabase

**Symptôme** : `np.array(embeddings)` produit un array d'objets (dtype=object) au lieu de float32.
**Cause** : pgvector retourne les embeddings comme strings JSON (`"[0.1, 0.2, ...]"`) via l'API Supabase Python.
**Solution** : détecter et parser si `isinstance(emb, str): emb = json.loads(emb)` avant `np.array()`.
**Fichier concerné** : `scripts/compute_umap.py`

---

### [PYTHON] ingest.py — Python 3.9 incompatible avec `str | None`

**Symptôme** : `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`
**Cause** : la syntaxe `str | None` pour les unions de types est disponible à partir de Python 3.10 seulement.
**Solution** : remplacer `str | None` par `object` (ou `Optional[str]` avec import typing) dans toutes les annotations.
**Fichier concerné** : `scripts/ingest.py`

---

---

### [VERCEL] Pipeline veille — résumé IA (HTTP 401 Authentication Required)

**Symptôme** : `Échec route résumé (HTTP 401) : <!doctype html>...<title>Authentication Required</title>`
**Cause** : `process.env.VERCEL_URL` retourne l'URL de déploiement spécifique (ex: `alexandria-git-main-abc.vercel.app`) qui est protégée par Vercel Deployment Protection. Ce n'est pas le 401 de l'API, c'est Vercel qui bloque avant même d'atteindre la route.
**Solution** : utiliser `VERCEL_PROJECT_PRODUCTION_URL` (variable système Vercel auto-injectée) ou définir manuellement `VERCEL_APP_URL` dans Vercel Settings → Environment Variables (valeur : `https://alexandria-dusky.vercel.app`).
```ts
const baseUrl = process.env.VERCEL_APP_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
  ?? 'http://localhost:3000'
```
**Fichier concerné** : `lib/veille/pipeline.ts`
**Date** : juin 2026

---

### [SUPABASE] Pipeline veille — résumé IA (HTTP 404 Run not found)

**Symptôme** : `Échec route résumé (HTTP 404) : {"error":"Run not found"}` — le run existe bien en base.
**Cause** : `getRunById()` utilisait `createClient()` (client serveur avec RLS). La table `veille_runs` n'est pas accessible via RLS depuis une route sans session utilisateur authentifiée.
**Solution** : utiliser `getAdminSupabase()` (service role) dans `getRunById()`.
```ts
// ❌ Avant
const supabase = await createClient()
// ✅ Après
const supabase = getAdminSupabase()
```
**Fichier concerné** : `lib/db/veille.ts` — fonction `getRunById`
**Règle générale** : toutes les fonctions DB appelées depuis des routes cron ou des pipelines background doivent utiliser le client admin, pas le client RLS.
**Date** : juin 2026

---

### [SUPABASE] Pipeline veille — résumé IA vide `{"themes":[],"articles":[]}`

**Symptôme** : résumé sauvegardé mais vide, `high_score_count = 0` alors que des articles éligibles existent.
**Cause** : `listVeilleItems()` utilisait `createClient()` (RLS). Depuis la route summarize (pas de session utilisateur), la requête retournait 0 lignes silencieusement — pas d'erreur, juste un tableau vide.
**Solution** : utiliser `getAdminSupabase()` dans `listVeilleItems()`.
**Fichier concerné** : `lib/db/veille.ts` — fonction `listVeilleItems`
**Date** : juin 2026

---

### [VERCEL] Pipeline veille — résumé IA bloqué indéfiniment (status=running)

**Symptôme** : le run reste bloqué en `status=running`, phase `summary`, sans jamais se terminer.
**Cause** : le `fetch` vers la route summarize n'avait pas de timeout. Si la route ne répondait pas, le pipeline attendait indéfiniment. `waitUntil` finissait par être tué silencieusement par Vercel sans marquer le run comme terminé.
**Solution** : ajouter `signal: AbortSignal.timeout(55_000)` sur le fetch, et si le run reste bloqué, le corriger manuellement en DB :
```sql
UPDATE veille_runs
SET status='failed', completed_at=now(), error_message='Pipeline bloqué phase summary'
WHERE id='<run_id>';
```
**Fichier concerné** : `lib/veille/pipeline.ts`
**Date** : juin 2026

---

### [VERCEL] Pipeline veille — résumé IA (Connection error. — OpenAI SDK dans waitUntil)

**Symptôme** : `Échec résumé IA : Connection error.` — erreur systématique, 3 tentatives en ~15s.
**Cause** : le SDK OpenAI utilise **`undici`** comme client HTTP interne. Dans le contexte `waitUntil` de Vercel (après ~150s d'exécution), `undici` échoue à établir de nouvelles connexions TCP vers `api.openai.com`. Ce n'est pas un problème de clé API ni de réseau — c'est une incompatibilité entre `undici` et le contexte background Vercel.
**Solution** : remplacer l'appel SDK par un `fetch` natif Node.js qui, lui, fonctionne dans ce contexte (comme les appels OpenAlex).
```ts
// ❌ À ne jamais faire dans un contexte waitUntil
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const res = await openai.chat.completions.create({ ... })

// ✅ Utiliser fetch natif
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({ model: 'gpt-4o-mini', ... }),
  signal: AbortSignal.timeout(120_000),
})
```
**Fichier concerné** : `lib/veille/summarize.ts`
**Règle générale** : dans un pipeline background Vercel (`waitUntil`), **toujours utiliser `fetch` natif** pour les appels HTTP externes. Ne jamais utiliser le SDK OpenAI directement.
**Date** : juin 2026

---

## Erreurs à investiguer

Ajouter ici les erreurs rencontrées mais non encore résolues :

```
### [CONTEXTE] Titre

**Symptôme** :
**Hypothèse** :
**Pistes** :
**Date** :
```
