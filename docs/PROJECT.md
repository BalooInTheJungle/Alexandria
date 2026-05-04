# PROJECT — Vision Alexandria

Référence : vision, utilisateurs, flows d'usage.
Détail complet → `documentation/VUE_ENSEMBLE_PROJET.md`

---

## Contexte

| Élément | Description |
|---------|-------------|
| **Porteur** | Chercheur CNRS — Molecular Materials & Magnetism |
| **Problème** | 1h30/semaine de veille manuelle, ~10 000 articles accumulés sur 20 ans, capital scientifique inexploité |
| **Solution** | Outil cloud unique : RAG sur corpus + veille automatisée + scoring de pertinence personnalisé |
| **Hébergement** | Cloud uniquement (Supabase + Vercel) — pas d'on-prem |

---

## Deux axes fonctionnels

### Axe 1 — RAG scientifique
Interroger les ~10 000 articles PDF en langage naturel (FR ou EN) :
- Recherche hybride (sémantique + lexicale) sur le corpus
- Réponses sourcées avec citations [1], [2]... et lien vers le PDF
- Réponse dans la même langue que la requête
- Garde-fou : si la question est hors domaine, pas d'hallucination LLM

### Axe 2 — Veille automatisée
Scanner ~43 sources scientifiques chaque semaine :
- Extraction titre + abstract + DOI depuis flux RSS et OpenAlex
- Score de pertinence : similarité de l'abstract vs le corpus personnel
- Liste rankée par pertinence scientifique personnalisée
- Accès direct à l'URL de l'article

---

## Utilisateurs

| Persona | Besoins | Contraintes |
|---------|---------|-------------|
| **Chercheur (porteur)** | RAG + veille rankée + upload PDF | Temps limité, critères exigeants |
| **Collègue autorisé** | Accès RAG + veille | Accès contrôlé |
| **Système (cron)** | Scraping + ingestion automatique | Coût maîtrisé |

Login obligatoire (Supabase Auth) pour tout accès.

---

## Flows d'usage principaux

### Flow RAG
1. Utilisateur connecté → section RAG
2. Pose une question en FR ou EN
3. Détection langue → pipeline FR ou EN
4. Recherche hybride (FTS + vector + RRF) → top-K chunks
5. Garde-fou : similarité < seuil → message "hors domaine", pas d'appel LLM
6. Sinon : LLM (gpt-4o-mini) → réponse streaming + citations
7. Consultation des sources, ouverture PDF

### Flow Veille
1. Cron 6h UTC (ou bouton manuel)
2. Scraping RSS (43 journaux) + OpenAlex → titre, DOI, abstract
3. Filtre 7 jours + dédup par DOI
4. Embedding abstract → similarité vs corpus → score
5. Utilisateur voit liste rankée → clique vers l'article source

### Flow Upload PDF
1. Utilisateur → section Documents
2. Upload PDF → `data/pdfs/` + insert `documents`
3. Ingestion : parse → chunk → embed EN + traduction → embed FR
4. Document devient searchable dans le RAG

---

## Critères de pertinence (veille)

- Auteurs et laboratoires connus du chercheur
- Proximité thématique avec les travaux du chercheur
- Similarité sémantique abstract vs corpus historique
- **Pas** d'impact factor ni de citations (articles lus le jour de leur publication)
- Objectif : identifier travaux incrémentaux ET ruptures scientifiques

---

## Références
- `documentation/VUE_ENSEMBLE_PROJET.md` — détail complet
- `docs/ARCHITECTURE.md` — schéma technique
- `docs/ROADMAP.md` — plan d'évolution
