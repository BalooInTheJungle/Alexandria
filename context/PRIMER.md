# PRIMER — État initial de session

Ce fichier est à charger au début de chaque session Claude Code.
Il donne l'état du projet à l'instant t pour éviter de re-expliquer le contexte.

---

## Projet en une phrase

Alexandria est un outil de recherche scientifique pour un chercheur CNRS :
- **RAG** : interroger ~10 000 articles PDF en langage naturel (FR ou EN)
- **Veille** : scraper ~43 sources scientifiques, scorer les nouveaux articles par pertinence

---

## État actuel (mai 2026)

### Back — tout est en place

| Fonctionnalité | État |
|---------------|------|
| RAG chat (FR + EN, streaming, garde-fou) | ✅ |
| Conversations + historique + pagination | ✅ |
| Paramètres RAG dynamiques (rag_settings) | ✅ |
| Pipeline veille (RSS 43 sources + OpenAlex + scoring) | ✅ |
| Cron rétention 30 jours | ✅ |
| Ingestion PDF Python (EN + traduction FR) | ✅ |
| API documents (list) | ✅ |
| API veille (list, scrape, status, runs, items) | ✅ |
| API sources (GET + POST + PATCH) | ✅ |
| Scoring double (similarity_score + heuristic_score) | ✅ |
| Résumé IA hebdomadaire (GPT-4o-mini) | ✅ |
| Progression pipeline live (phase + items_processed) | ✅ |
| Nettoyage abstracts RSS (stripCitationPrefix) | ✅ |

### Front — structurellement avancé

| Composant | État |
|-----------|------|
| Navigation header (Chatbot / Database / Bibliographie) | ✅ |
| Page RAG (sidebar + messages + input) | ✅ Fonctionnelle |
| `RagConversationSidebar` (liste, rename, delete) | ✅ |
| `RagMessageList` (pagination cursor, scroll infini) | ✅ |
| Streaming SSE + citations `[1][2]` | ⚠️ Non vérifié (messages en `<pre>` brut) |
| Page RAG settings | ⚠️ Existe, non testée |
| Page Bibliographie (2 onglets, cards articles, slider seuil) | ✅ Fonctionnelle |
| Cards articles (badge score coloré, abstract, lien "Dans le corpus") | ✅ |
| 4 phases pipeline live + barre progression scoring | ✅ |
| Résumé IA (markdown rendu, compteur articles) | ✅ |
| "Articles cités cette semaine" (liste numérotée) | ✅ |
| Onglet Historique (tableau runs + lien détail) | ✅ |
| Page `/bibliographie/historique/[runId]` | ✅ |
| Page Sources (`/bibliographie/sources`) | ✅ Fonctionnelle |
| Upload PDF via UI | ❌ N'existe pas encore |

---

## Session mai 2026 — ce qui a été fait (2 sessions)

### Session 1 — Page Sources + filtre publications finales

- Migration SQL `active boolean` sur `sources`
- `lib/db/sources.ts` — getSources, toggleSourceActive, addSource
- `app/api/veille/sources/` — GET + POST + PATCH
- `app/(dashboard)/bibliographie/sources/page.tsx` — groupé par éditeur, toggle, dialog ajout
- `openalex.ts` — filtre `type:article` + `is_final` flag
- `pipeline.ts` — skip si is_final=false

### Session 2 — Veille UX complète

**Bugs corrigés :**
- `run_id` vs `runId` mismatch → polling ne démarrait jamais
- `nullsFirst: false` → articles avec null score s'affichaient en premier
- `onProgress` callback pendant le scoring (toutes les 50 items)
- `bothScores` hors scope → erreur de compilation
- Phase "Filtrage LLM" inexistante → retirée du front

**Nouvelles fonctionnalités :**
- Scoring double : `similarity_score` (vectoriel) + `heuristic_score` (radicaux, informatif)
- `scoreFinal = similarity_score` seul (heuristic non discriminant pour la chimie)
- Résumé IA GPT-4o-mini : top 15 articles ≥ 0.75, chunks corpus contextualisés, titres documents cités
- Progress live : phase + items_processed/items_total (update toutes les 50)
- `stripCitationPrefix()` : nettoyage abstracts RSS (RSC/Wiley/ACS)
- Page bibliographie refonte complète : cards 2 colonnes, slider seuil 30–90%, onglet historique
- "Articles cités cette semaine" : liste numérotée avec liens DOI

**Migration appliquée :**
- `supabase/migrations/20260504110000_veille_run_summary.sql`
  - `veille_runs` : + `ai_summary text`, `high_score_count int`, `score_threshold real`

---

## Prochaine session — objectifs possibles

- Upload PDF via UI (voir `docs/ROADMAP.md`)
- Vérifier/corriger Streaming SSE + citations `[1][2]` dans le RAG
- Tests de la veille en production (logs Vercel)
- Marquer articles "à lire"/"lu"/"ignoré" (V2)

---

## Stack technique

| Couche | Techno |
|--------|--------|
| Front + API | Next.js 14, App Router, TypeScript |
| Base de données | Supabase (Postgres + pgvector + Auth) |
| Embeddings (requête) | @xenova/transformers, all-MiniLM-L6-v2, 384D |
| Embeddings (ingestion) | sentence-transformers Python, même modèle |
| Génération RAG | OpenAI gpt-4o-mini, streaming SSE |
| Résumé veille | OpenAI gpt-4o-mini (non-streaming) |
| Ingestion PDF | Python : PyMuPDF + OCR Tesseract + MarianMT (EN→FR) |
| Déploiement | Vercel |

---

## Fichiers clés à connaître

| Fichier | Rôle |
|---------|------|
| `lib/rag/search.ts` | Recherche hybride FTS + vector + RRF |
| `lib/rag/embed.ts` | Embedding de la requête (Xenova) |
| `lib/rag/openai.ts` | Génération réponse (streaming) |
| `lib/rag/detect-lang.ts` | Détection FR/EN |
| `lib/rag/settings.ts` | Lecture + validation rag_settings |
| `lib/veille/sources.ts` | Chargement sources RSS + OpenAlex depuis DB (filtre active=true) |
| `lib/veille/pipeline.ts` | Orchestrateur veille — 11 phases avec updateRunPhase |
| `lib/veille/score.ts` | scoreVeilleItems (similarity + heuristic, onProgress callback) |
| `lib/veille/summarize.ts` | generateVeilleSummary — GPT-4o-mini + chunks corpus |
| `lib/veille/fetch-rss.ts` | RSS fetch + stripCitationPrefix (nettoyage abstracts) |
| `lib/veille/openalex.ts` | Fetch OpenAlex — abstracts, filtre type:article |
| `lib/db/veille.ts` | updateRunPhase, saveRunSummary, updateVeilleItemBothScores, listVeilleItems |
| `lib/db/sources.ts` | getSources, toggleSourceActive, addSource |
| `lib/db/types.ts` | Types TypeScript partagés (Source, SourceInsert…) |
| `lib/ingestion/` | Parse PDF, chunk, index |
| `app/(dashboard)/bibliographie/page.tsx` | Page veille — 2 onglets, polling, cards, slider |
| `app/api/veille/scrape/route.ts` | POST déclenche pipeline, retourne runId ET run_id |
| `scripts/ingest.py` | Ingestion PDF (Python, lancement manuel) |
| `supabase/migrations/` | 16 migrations SQL |

---

## Schéma veille_runs (état actuel)

```sql
veille_runs (
  id uuid PK,
  status text,           -- pending | running | completed | failed | stopped
  phase text,            -- sources | urls | items | summary | done
  items_processed int,   -- mis à jour toutes les 50 pendant scoring
  items_total int,
  abort_requested boolean,
  ai_summary text,       -- résumé GPT-4o-mini (ajouté session 2)
  high_score_count int,  -- nb articles >= score_threshold (ajouté session 2)
  score_threshold real,  -- seuil utilisé pour le résumé (défaut 0.75)
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz
)
```

---

## Contraintes importantes

- `chunks.embedding` : **vector(384)** — dimension fixe, ne jamais changer
- `content_tsv` / `content_fr_tsv` : maintenus par triggers Postgres, ne pas écrire directement
- Client Supabase `admin.ts` : uniquement pour cron/ingestion (service role, bypasse RLS)
- `rag_settings` : relu à chaque requête — seul mécanisme de paramétrage dynamique
- `OPENAI_API_KEY` : ASCII imprimables uniquement
- `scoreFinal = similarity_score` seul (heuristic_score stocké mais non utilisé pour le tri)
- `scrape/route.ts` retourne `{ runId, run_id: runId }` — les deux clés pour compatibilité

---

## Références

- `docs/PROJECT.md` — vision et flows d'usage
- `docs/ARCHITECTURE.md` — schéma technique détaillé
- `docs/ROADMAP.md` — V1/V2/V3
- `documentation/PIPELINE_VEILLE_CONSOLIDE.md` — spec complète pipeline veille
- `documentation/FONCTIONNALITES_FRONT.md` — spec front (état mai 2026)
- `documentation/SCHEMA_DB_ET_DONNEES.md` — tables, migrations, flows
