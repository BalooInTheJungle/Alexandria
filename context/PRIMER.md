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
| API veille (list, scrape, status, runs) | ✅ |
| API sources | ❌ N'existe pas encore |

### Front — structurellement avancé

| Composant | État |
|-----------|------|
| Navigation header (Chatbot / Database / Bibliographie) | ✅ |
| Page RAG (sidebar + messages + input) | ✅ Fonctionnelle |
| `RagConversationSidebar` (liste, rename, delete) | ✅ |
| `RagMessageList` (pagination cursor, scroll infini) | ✅ |
| Streaming SSE + citations `[1][2]` | ⚠️ Non vérifié (messages en `<pre>` brut) |
| Page RAG settings | ⚠️ Existe, non testée |
| `VeilleDashboard` (liste, filtres, trigger, polling, historique) | ✅ Quasi-complet |
| `VeilleArticleCard` (score badge, titre cliquable, abstract) | ✅ |
| `DocumentsPage` (liste PDFs indexés avec statuts) | ✅ |
| Page Sources (gestion des 43 journaux) | ✅ Fonctionnelle |
| Upload PDF via UI | ❌ N'existe pas encore |

---

## Session mai 2026 — ce qui a été fait

**Page Sources** — complète :
- Migration SQL `active boolean` sur `sources` (appliquée via SQL Editor)
- `lib/veille/sources.ts` filtre `active=true` dans les deux fonctions
- `lib/db/sources.ts` — `getSources()`, `toggleSourceActive()`, `addSource()`
- `lib/db/types.ts` — type `Source` complet + `SourceInsert`
- `app/api/veille/sources/route.ts` — GET + POST
- `app/api/veille/sources/[id]/route.ts` — PATCH
- `app/(dashboard)/bibliographie/sources/page.tsx` — groupé par éditeur, toggle, dialog ajout
- `app/(dashboard)/layout.tsx` — lien "Sources" dans la nav

**Filtre publications finales** :
- `openalex.ts` `fetchAbstractsByDois` — filtre `type:article` côté API + retourne `is_final`
- `pipeline.ts` — skip si `is_final=false` (Phase 5 RSS enrichi + Phase 6 OpenAlex)
- Double protection : filtre API OpenAlex + vérification client-side

## Prochaine session — objectif ciblé

**Upload PDF via UI** (voir `docs/ROADMAP.md`) ou tests de la veille en production.

---

## Stack technique

| Couche | Techno |
|--------|--------|
| Front + API | Next.js 14, App Router, TypeScript |
| Base de données | Supabase (Postgres + pgvector + Auth) |
| Embeddings (requête) | @xenova/transformers, all-MiniLM-L6-v2, 384D |
| Embeddings (ingestion) | sentence-transformers Python, même modèle |
| Génération RAG | OpenAI gpt-4o-mini, streaming SSE |
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
| `lib/veille/sources.ts` | Chargement sources RSS + OpenAlex depuis DB |
| `lib/veille/` | Pipeline veille (fetch-rss, score, guardrails…) |
| `lib/ingestion/` | Parse PDF, chunk, index |
| `lib/db/sources.ts` | getSources, toggleSourceActive, addSource |
| `lib/db/types.ts` | Types TypeScript partagés (Source, SourceInsert…) |
| `lib/veille/openalex.ts` | Fetch OpenAlex — abstracts, DOI, ISSN, filtre type:article |
| `lib/veille/pipeline.ts` | Orchestrateur veille — 8 phases, filtre is_final |
| `scripts/ingest.py` | Ingestion PDF (Python, lancement manuel) |
| `scripts/import-sources.ts` | Upsert initial des 43 sources en DB |
| `supabase/migrations/` | 15 migrations SQL |

---

## Schéma sources (état actuel)

```sql
sources (
  id uuid,
  url text,
  name text,
  publisher text,
  issn text,
  rss_url text,
  source_type text ('rss' | 'openalex'),
  active boolean DEFAULT true,   -- filtre pipeline + toggle UI
  created_at timestamptz,
  last_checked_at timestamptz
)
```

---

## Contraintes importantes

- `chunks.embedding` : **vector(384)** — dimension fixe, ne jamais changer
- `content_tsv` / `content_fr_tsv` : maintenus par triggers Postgres, ne pas écrire directement
- Client Supabase `admin.ts` : uniquement pour cron/ingestion (service role, bypasse RLS)
- `rag_settings` : relu à chaque requête — seul mécanisme de paramétrage dynamique
- `OPENAI_API_KEY` : ASCII imprimables uniquement

---

## Références

- `docs/SPEC_SOURCES_PAGE.md` — spec complète de la page Sources (prochaine session)
- `docs/PROJECT.md` — vision et flows d'usage
- `docs/ARCHITECTURE.md` — schéma technique détaillé
- `docs/ROADMAP.md` — V1/V2/V3
- `documentation/` — docs techniques complètes (référence)
