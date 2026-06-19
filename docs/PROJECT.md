# PROJECT — Vision Alexandria

Référence : vision, utilisateurs, flows d'usage.

---

## Contexte

| Élément | Description |
|---------|-------------|
| **Porteur** | Chercheur CNRS — Molecular Materials & Magnetism |
| **Problème** | 1h30/semaine de veille manuelle, ~10 000 articles accumulés sur 20 ans, capital scientifique inexploité |
| **Solution** | Outil cloud unique : veille automatisée + lecture assistée + analyse approfondie |
| **Hébergement** | Cloud uniquement (Supabase + Vercel) — pas d'on-prem |

---

## Trois modules fonctionnels

### Module 1 — Veille bibliographique (automatisée)
Surveiller la littérature mondiale et ne remonter que ce qui est pertinent pour le chercheur :
- 44 sources RSS + Semantic Scholar (recommandations basées sur les articles de l'auteur)
- Score de similarité sémantique abstract ↔ corpus (Xenova 384D)
- Filtre de finalisation : articles définitivement publiés uniquement (pas de preprints/ASAP)
- Synthèse IA quotidienne (thèmes + analyse individuelle des articles ≥ 80%)
- Lecture/non-lu par article, historique des runs

### Module 2 — Lecture assistée (sur upload PDF)
Aider le chercheur à comprendre et contextualiser un article pertinent :
- Upload PDF (max 20 Mo) → parse → chunk → embed EN (384D)
- Résumé structuré GPT : tldr / problème & contexte / méthodes / résultats / discussion & limites
- Passages corpus les plus proches (match_chunks sur embedding moyen de l'article)
- Discussion IA en langage naturel : questions libres, citations `[N]` cliquables, scroll PDF synchronisé

### Module 3 — Analyse approfondie (sur le même article)
Croiser l'article analysé avec la bibliographie existante :
- Références citées dans l'article : croisement avec le corpus (DOI matching)
- Métadonnées Semantic Scholar pour chaque référence (titre, auteurs, année)
- Recommandations Semantic Scholar (10 articles similaires)
- Intégration corpus : les chunks temporaires deviennent permanents d'un clic

---

## Utilisateurs

| Persona | Besoins | Contraintes |
|---------|---------|-------------|
| **Chercheur (porteur)** | Veille quotidienne + lecture assistée + analyse | Temps limité, critères exigeants |
| **Système (cron)** | Pipeline veille GitHub Actions | Coût maîtrisé, 9h Paris chaque matin |

Login obligatoire (Supabase Auth) pour tout accès. Page publique `/` accessible sans connexion.

---

## Flows d'usage principaux

### Flow Veille (automatique)
1. GitHub Actions déclenche le pipeline à 7h UTC (9h Paris)
2. Job 1 : fetch 44 sources RSS + OpenAlex MDPI → filtre finalisation → dédup DOI → insert `veille_items`
3. Job 1b (optionnel) : Semantic Scholar recommandations basées sur `ss_representative_papers`
4. Job 2 : embed abstract → `match_chunks` → `similarity_score`
5. Job 3 : GPT analyse individuelle des articles ≥ 80% → `ai_analysis`
6. Job 4 : GPT synthèse globale → `ai_summary` dans `veille_runs`
7. Chercheur voit la liste `/bibliographie` → articles ≥ 75% → marque lu, consulte le détail run

### Flow Lecture assistée + Analyse
1. Chercheur va sur `/analyse` → upload PDF
2. `POST /api/analyse/upload` → parse → chunk → embed → stocke dans `document_analyses` + `chunks (is_temp=true)`
3. Page `/analyse/[id]` se charge → appelle `GET /api/analyse/[id]/insights`
4. Insights calculés en parallèle : résumé GPT + corpus_refs + cited_refs (SS batch) + ss_recs
5. Onglet **Résumé** : tldr + 4 sections structurées
6. Onglet **Proximité corpus** : passages du corpus les plus proches avec score
7. Onglet **Discussion** : chat libre sur le document (PDF gauche + chat droite), citations [N] cliquables, scroll PDF synchronisé sur la source cliquée
8. Onglet **Aller plus loin** : références citées (✓ corpus ou —) + recommandations Semantic Scholar
9. Bouton "Intégrer au corpus" → chunks `is_temp=false` → document permanent

---

## Critères de pertinence (veille)

- Proximité thématique avec les travaux du chercheur (similarité sémantique abstract ↔ corpus)
- Filtre qualité : articles définitivement publiés (OpenAlex `is_final=true` + CrossRef fallback)
- **Pas** d'impact factor ni de citations — objectif : identifier travaux incrémentaux ET ruptures
- Seuil d'affichage : ≥ 75% de similarité (configurable)
- Seuil d'analyse IA : ≥ 80%
