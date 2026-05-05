# SESSION LOG — Alexandria

Journal des sessions de développement. Ajouter une entrée à chaque session.

---

## Template de session

```
## Session YYYY-MM-DD

**Objectif** : [Ce qu'on voulait accomplir]

**Réalisé** :
- [x] Étape 1 : description
- [x] Étape 2 : description
- [ ] Étape 3 : non terminée — raison

**Fichiers modifiés** :
- `chemin/fichier.ts` — description du changement

**Problèmes rencontrés** :
- Problème : description → Solution : description
- Problème ouvert : description (à reprendre)

**Prochaine session** :
- [ ] Reprendre à : description précise
- [ ] Tester : comportement attendu
```

---

## Sessions

<!-- Ajouter les sessions ici, la plus récente en premier -->

## Session 2026-05-04 (2ème partie) — Veille UX complète

**Objectif** : Corriger la connexion back↔front veille après merge, améliorer UX et scoring

**Réalisé** :
- [x] Fix `run_id` vs `runId` mismatch dans `scrape/route.ts` (polling ne démarrait pas)
- [x] Fix `nullsFirst: false` dans `listVeilleItems` (articles null score s'affichaient en tête)
- [x] Scoring double : `similarity_score` (vectoriel) + `heuristic_score` (radicaux corpus, informatif)
- [x] `onProgress` callback dans `scoreVeilleItems` toutes les 50 items
- [x] `updateRunPhase` + `saveRunSummary` + `updateVeilleItemBothScores` dans `lib/db/veille.ts`
- [x] 11 phases pipeline dans `lib/veille/pipeline.ts` avec progress live
- [x] `lib/veille/summarize.ts` — résumé GPT-4o-mini : top 15 articles, chunks corpus, titres docs
- [x] Migration `20260504110000_veille_run_summary.sql` (ai_summary, high_score_count, score_threshold)
- [x] `stripCitationPrefix()` dans `fetch-rss.ts` — nettoyage abstracts RSS (RSC/Wiley/ACS)
- [x] Page bibliographie refonte complète (2 onglets, cards 2 colonnes, slider seuil 30–90%)
- [x] Cards article : badge score coloré, abstract, badge "Dans le corpus", lien DOI
- [x] 4 pills de phases + barre de progression pendant scoring
- [x] Résumé IA rendu markdown, compteur articles pertinents
- [x] "Articles cités cette semaine" — liste numérotée avec liens DOI
- [x] Onglet Historique avec high_score_count + score_threshold
- [x] Documentation mise à jour : PIPELINE_VEILLE_CONSOLIDE.md, SCHEMA_DB_ET_DONNEES.md, ROADMAP.md, FONCTIONNALITES_FRONT.md, PRIMER.md, SESSION_LOG.md

**Fichiers modifiés** :
- `app/api/veille/scrape/route.ts` — retourne runId ET run_id
- `app/api/veille/items/route.ts` — minScore query param
- `lib/db/veille.ts` — updateRunPhase, saveRunSummary, updateVeilleItemBothScores, minScore, nullsFirst
- `lib/veille/score.ts` — loadCorpusTerms, scoreHeuristic, onProgress callback
- `lib/veille/pipeline.ts` — 11 phases, bothScores hors scope, sourceMap, try/catch summary
- `lib/veille/fetch-rss.ts` — stripCitationPrefix, conversion reject → extract
- `lib/veille/summarize.ts` — NOUVEAU fichier
- `app/(dashboard)/bibliographie/page.tsx` — refonte complète
- `app/(dashboard)/bibliographie/historique/[runId]/page.tsx` — scoreFinal = similarity seul
- `supabase/migrations/20260504110000_veille_run_summary.sql` — NOUVEAU fichier

**Problèmes rencontrés** :
- `run_id` vs `runId` → Fix : retourner les deux dans la réponse scrape
- Score heuristique non discriminant (0.06–0.20 pour tous les articles chimie) → Décision : garder en DB mais `scoreFinal = similarity_score` seul
- `bothScores` hors scope → Fix : déclaration avant le bloc `if`
- Phase "Filtrage LLM" jamais émise → Retirée du front
- Markdown GPT non rendu → Fix : inline renderer avec split `\n`
- `doc_title` absent du résumé → Fix : `fetchCorpusChunks` retourne `{ doc_title, content }`
- Abstracts RSC/Wiley avec métadonnées en tête → Fix : `stripCitationPrefix()`

**Prochaine session** :
- [ ] Upload PDF via UI (priorité V1.5)
- [ ] Vérifier/corriger Streaming SSE + citations `[1][2]` dans le RAG
- [ ] Tests de la veille en production (logs Vercel)
- [ ] Marquer articles "à lire"/"lu"/"ignoré" (V2)

---

## Session 2026-05-04

**Objectif** : Créer la structure de documentation complète du projet

**Réalisé** :
- [x] Mise à jour CLAUDE.md (racine)
- [x] Création .env.example
- [x] Création context/ (PRIMER, HINDSIGHT, SESSION_LOG, memory.sh)
- [x] Création docs/ (PROJECT, ARCHITECTURE, ROADMAP, DECISIONS, ERRORS, GLOSSARY)
- [x] Création agents/ (SESSION_PRIMER, DEBUG)
- [x] Création skills/ (create-component, generate-migration, add-veille-source)

**Fichiers créés** :
- `CLAUDE.md` — briefing permanent mis à jour
- `.env.example` — template variables d'environnement
- `context/PRIMER.md` — état de session initial
- `context/HINDSIGHT.md` — profil de travail
- `context/SESSION_LOG.md` — ce fichier
- `context/memory.sh` — script git
- `docs/PROJECT.md` — vision condensée
- `docs/ARCHITECTURE.md` — schéma technique
- `docs/ROADMAP.md` — V1/V2/V3
- `docs/DECISIONS.md` — décisions stack + contraintes
- `docs/ERRORS.md` — erreurs communes
- `docs/GLOSSARY.md` — glossaire bilingue
- `agents/SESSION_PRIMER.md` — contexte universel
- `agents/DEBUG.md` — guide de debug
- `skills/create-component.md` — recette composant Next.js
- `skills/generate-migration.md` — recette migration Supabase
- `skills/add-veille-source.md` — recette ajout source veille

**Prochaine session** :
- [ ] Démarrer avec `context/PRIMER.md` + `docs/SPEC_SOURCES_PAGE.md`
- [ ] Étape 1 : migration `sources_active.sql` + `npx supabase db push`
- [ ] Étape 2 : mettre à jour `lib/veille/sources.ts` (filtre active=true)
- [ ] Étape 3 : remplir `lib/db/sources.ts` + types
- [ ] Étape 4 : créer API `/api/veille/sources` (GET, POST, PATCH)
- [ ] Étape 5 : créer page `/bibliographie/sources`
- [ ] Étape 6 : ajouter lien "Sources" dans la navigation
- [ ] Tester : lancer la veille, vérifier les scores, désactiver une source
