# Stratégie de veille scientifique — Alexandria

**Rôle** : document de référence pour la stratégie d'extraction automatique des publications scientifiques. Contexte, pistes explorées, problèmes rencontrés, stratégie retenue.

---

## 1. Contexte et contraintes

| Élément | Valeur |
|---|---|
| **Domaine** | Molecular Materials & Magnetism |
| **Sources à surveiller** | ~50 journaux scientifiques (ACS, RSC, Wiley, Nature…) |
| **Volume cible** | ~100 nouveaux articles par semaine |
| **Fréquence** | Automatique, chaque matin |
| **Ce qu'on veut** | Titre + auteurs + DOI + **abstract** + date de publication |
| **Ce qu'on ne veut pas** | Preprints, news, commentaires éditoriaux, corrections |
| **Déclenchement** | Automatique (cron quotidien) |

---

## 2. La distinction critique : publication finale vs preprint

C'est le problème central. Un article scientifique passe par plusieurs stades :

```
Soumission → Peer review → Accepted Manuscript → ASAP/Online First → Publication finale (Volume + Issue)
                                                                          ↑
                                                              C'est ça qu'on veut
Preprint (arXiv, ChemRxiv) ← jamais de Volume/Issue, jamais dans un journal officiel
```

**Comment identifier une publication finale de façon fiable :**
- Présence d'un **DOI d'éditeur** (ex. `10.1021/`, `10.1039/`, `10.1002/`) → bon signal
- Présence d'un **volume** + **numéro** (issue) dans les métadonnées → publication finale confirmée
- Les ASAP/Online First (comme ACS ASAP) **comptent** : peer-reviewed, acceptés, DOI éditeur → à inclure
- Preprints (arXiv, ChemRxiv) : pas de volume/issue, DOI en `10.26434/` (ChemRxiv) ou `10.48550/` (arXiv) → à exclure

---

## 3. Ce qui a déjà été essayé

### 3.1 Scraping HTML des sites éditeurs
**Problème** : chaque site a une structure différente, souvent avec JavaScript, protections anti-bot, et l'information est très fragmentée. Maintenance très lourde pour 50 sources.

### 3.2 RSS des sites éditeurs
**Problème** : les flux RSS existent pour certains (ACS, RSC, Wiley) mais pas tous, formats inconsistants, et ils donnent rarement l'abstract complet — juste titre + auteurs + lien.

### 3.3 Extraction IA sur HTML
**Problème** : coûteux en tokens, instable selon la structure de chaque page, et difficile à distinguer publication finale vs contenu éditorial.

---

## 4. Stratégies possibles

### Stratégie A — Gmail API + CrossRef (newsletters → DOI → abstract)
**Principe** : lire automatiquement les newsletters déjà dans Gmail, extraire les DOIs présents dans les emails, puis interroger CrossRef/Semantic Scholar avec ces DOIs pour récupérer l'abstract.

| Critère | Éval |
|---|---|
| Fiabilité | ⭐⭐⭐⭐ — les emails éditeurs sont structurés et fiables |
| Abstracts | ⭐⭐⭐ — CrossRef a les abstracts pour la plupart des éditeurs |
| Complexité setup | ⭐⭐ — inscription manuelle aux newsletters, config OAuth Gmail |
| Coût | Gratuit |
| Inconvénient | Inscription à chaque newsletter une fois manuellement |

### Stratégie B — RSS feeds des éditeurs + CrossRef/OpenAlex
**Principe** : interroger directement les flux RSS des journaux (ACS, RSC, Wiley, Nature ont tous des RSS), extraire les DOIs, compléter avec CrossRef/OpenAlex pour l'abstract.

| Critère | Éval |
|---|---|
| Fiabilité | ⭐⭐⭐⭐ — ACS/RSC/Wiley RSS très stables |
| Abstracts | ⭐⭐⭐ — via CrossRef ou OpenAlex en complément |
| Complexité setup | ⭐⭐⭐⭐ — pas d'inscription manuelle, juste les URLs RSS |
| Coût | Gratuit |
| Inconvénient | Certains éditeurs (Elsevier, Nature) ont des RSS moins fiables |

### Stratégie C — APIs scientifiques directes (OpenAlex + Semantic Scholar)
**Principe** : interroger OpenAlex ou Semantic Scholar directement par ISSN du journal (chaque journal a un ISSN unique), filtrer par date de publication récente.

| Critère | Éval |
|---|---|
| Fiabilité | ⭐⭐⭐⭐⭐ — données structurées, pas de scraping |
| Abstracts | ⭐⭐⭐⭐ — OpenAlex et Semantic Scholar ont ~80% des abstracts |
| Complexité setup | ⭐⭐⭐⭐⭐ — aucune inscription newsletter, juste les ISSNs |
| Coût | Gratuit (limites généreuses) |
| Inconvénient | Délai possible entre publication et indexation (1-2 jours) |

### Stratégie D — Outils existants (Feedly, Researcher App, Dimensions…)
**Problème** : aucun ne propose d'API pour extraire les données vers Alexandria. Utiles pour lecture humaine, pas pour alimentation automatique d'une base vectorielle.

---

## 5. Les APIs retenues

### CrossRef (`api.crossref.org`)
- **Standard mondial** des DOIs — tous les éditeurs y déposent les métadonnées
- Gratuit, sans inscription, ~50 req/sec
- Ajouter `?mailto=ton@email.com` dans chaque requête → accès "polite pool" (meilleure priorité)
- Fournit : titre, auteurs, journal, volume, issue, date, abstract (quand disponible)
- Filtrer par journal ISSN + date : `filter=issn:XXXX-XXXX,from-pub-date:2026-04-01`
- **Indicateur publication finale** : vérifier présence de `volume` + `issue` dans la réponse

### OpenAlex (`api.openalex.org`)
- 250M publications, open source, gratuit
- Abstracts disponibles pour la majorité, filtrables par `has_abstract:true`
- Filtrage par journal ISSN + date de mise à jour : `filter=locations.source.issn:XXXX,from_updated_date:2026-04-01`
- Idéal en **fallback** quand CrossRef n'a pas l'abstract

### Semantic Scholar (`api.semanticscholar.org`)
- 200M articles, IA pour enrichissement
- Abstracts très bien couverts (sauf Springer)
- Limite : 1 req/sec avec clé API gratuite (suffisant pour ~100 articles/semaine)
- Idéal pour enrichir des articles où CrossRef + OpenAlex n'ont pas l'abstract

---

## 6. Stratégie recommandée

**Combinaison : RSS éditeurs → CrossRef → OpenAlex (fallback) → Semantic Scholar (fallback)**

```
[Cron quotidien - chaque matin]
         │
         ▼
[RSS ACS + RSC + Wiley + Nature + autres]
         │  extraire : titre, DOI, date
         ▼
[Déduplication DOI vs veille_items en base]
         │  skip si DOI déjà connu
         ▼
[CrossRef API par DOI]
         │  récupérer : abstract, volume, issue, auteurs, journal
         │  vérifier : volume + issue présents → publication finale ✅
         ▼
[Si abstract manquant → OpenAlex par DOI]
         │
         ▼
[Si abstract encore manquant → Semantic Scholar par DOI]
         │
         ▼
[Embedding abstract → similarité vs corpus → similarity_score]
         │
         ▼
[Insert veille_items] → affichage liste rankée dans Alexandria
```

**Pourquoi RSS comme source principale et non Gmail :**
- Pas d'inscription manuelle à 50 newsletters
- RSS ACS/RSC/Wiley sont stables et bien documentés
- Résultat identique car les newsletters viennent des mêmes données RSS

**Pour les éditeurs sans RSS fiable (Elsevier, Springer) :**
- Interroger OpenAlex directement par ISSN + date

---

## 7. Liste des sources à configurer

| Éditeur | Type source | Notes |
|---|---|---|
| ACS Publications | RSS | `pubs.acs.org/page/follow.html` — 1 flux par journal |
| RSC | RSS | eAlerts + RSS disponibles |
| Wiley / ChemistryEurope | RSS | 1 clic par journal |
| Nature Publishing | RSS | Disponible, structure variable |
| Elsevier | OpenAlex ISSN | RSS moins fiable → API directe |
| Springer | OpenAlex ISSN | Semantic Scholar pour abstracts |

Les ISSNs de chaque journal sont à stocker dans la table `sources` en base (colonne à ajouter : `issn`, `rss_url`, `source_type`).

---

## 8. Prochaines étapes

| Étape | Statut | Détail |
|---|---|---|
| Mettre à jour le schéma DB (`issn`, `rss_url`, `source_type`) | ✅ Fait | Migration `20260207100000_sources_rss.sql` |
| Renseigner les 45 journaux en base | ✅ Fait | Script `scripts/import-sources.ts` |
| Implémenter le parser RSS | ✅ Fait | `lib/veille/fetch-rss.ts` + `sources.ts` — testé 5/5 flux OK |
| Implémenter le client CrossRef | ✅ Fait | `lib/veille/crossref.ts` — valide is_final, récupère métadonnées |
| Implémenter OpenAlex | ✅ Fait | `lib/veille/openalex.ts` — DOI Elsevier ✅, MDPI complet ✅, batch 50 DOIs ✅ |
| Pipeline orchestration | ✅ Fait | `lib/veille/pipeline.ts` — filtre 7 jours + batch OpenAlex |
| Route `POST /api/veille/scrape` | ✅ Fait | Déclenche pipeline fire-and-forget, retourne `{ok, run_id}` |
| Route `GET /api/veille/list` | ✅ Fait | Retourne items du dernier run complété, triés par `similarity_score DESC`, `?limit=N` |
| Route `GET /api/veille/status/[runId]` | ✅ Fait | Retourne statut run + `item_count` + `scored_count` (pour polling front) |
| Scoring similarité | ✅ Fait | `lib/veille/score.ts` — embed abstract → `match_chunks` RPC → `similarity_score` |
| Page front veille | ✅ Fait | `components/veille/VeilleDashboard.tsx` — bouton + polling + liste rankée |
| Optimisation vitesse | ✅ Fait | Filtre 7 jours + batch OpenAlex (50 DOIs/requête au lieu de 1) |
| Nettoyage code obsolète | ✅ Fait | 6 stubs ancienne stratégie + 5 scripts dev supprimés |
| Test suite veille | ✅ Fait | `scripts/test-veille.ts` — 7 tests couvrant toute la pipeline |
| Auteurs RSS | ✅ Fait | `fetch-rss.ts` extrait `dc:creator` — ACS 100%, Wiley 100%, RSC 0% (champ absent de leur RSS) |
| Cron automatique | ✅ Fait | `GET /api/cron/veille` — 6h00 UTC chaque matin, `maxDuration=300s`, protégé `CRON_SECRET` |

---

## 9. Décisions validées

| Question | Décision |
|---|---|
| Inclure les ASAP/Online First ? | **Oui** — peer-reviewed, DOI éditeur, publication finale |
| Open Access uniquement ? | **Non** — tous les articles, abstract suffit (pas besoin du PDF) |
| Objectif | Récupérer uniquement **titre + auteurs + DOI + abstract + date** |
| Fenêtre temporelle | **7 jours** — évite de backfiller tout l'historique RSS |
| Enrichissement OpenAlex | **Batch 50 DOIs/requête** — réduit ~200 appels individuels à ~4 requêtes pour ACS |

---

## 10. Performance attendue après optimisations

| Scénario | Avant | Après |
|---|---|---|
| Premier run JACS (218 articles) | ~65s (218 × 300ms) | Ignoré (> 7 jours) |
| Run quotidien JACS (5 nouveaux articles) | 1.5s (5 × 300ms) | ~0.3s (1 batch) |
| Run quotidien 43 sources | Plusieurs minutes | < 30s si < 50 articles/source sans abstract |

**Premier run reste lent** pour les sources sans filtre de date côté API (RSS) : le filtre 7 jours est appliqué après le fetch, donc les 100 articles sont récupérés mais 95+ sont immédiatement skippés. Les runs suivants sont rapides.

---

## 11. Analyse technique : choix d'infrastructure

### Besoins réels du pipeline quotidien

| Phase | Temps séquentiel | Temps parallèle |
|---|---|---|
| Fetch 43 RSS (réseau) | ~65s (43 × 1.5s) | **~16s** (9 batches × 1.5s, 5 concurrent) |
| Délais polis entre sources | ~13s (43 × 300ms) | ~2.4s (9 × 300ms) |
| OpenAlex batch abstracts | ~2s (1 requête cross-sources) | ~2s |
| Lookup DOI individuels (Elsevier) | ~2s (quelques/jour) | ~2s |
| Insertion DB | ~1s | ~1s |
| Scoring embeddings (~20 articles) | ~5s | ~5s |
| **Total estimé** | **~88s** | **~28s** |

### Comparaison des outils

| Outil | Max duration | Pipeline séquentiel | Pipeline parallèle | Monitoring | Déclenchement UI |
|---|---|---|---|---|---|
| Vercel Hobby | 10s | ❌ | ❌ | — | ❌ |
| Vercel Pro (default) | 60s | ❌ | ✅ serré | ✅ | ✅ |
| **Vercel Pro + maxDuration=300s** | **300s** | **✅ confortable** | **✅ large marge** | **✅** | **✅** |
| GitHub Actions | 6h | ✅ | ✅ | ⚠️ séparé | ❌ |
| Supabase Edge Function | 150s (gratuit) | ✅ | ✅ | ⚠️ séparé | refactor |

### Décision : Vercel Pro + pipeline parallèle

**Vercel Pro ($20/mois)** est le bon choix car :
- Même plateforme que le reste de l'app → monitoring unifié (logs, alertes)
- Déclenchement manuel depuis l'UI et cron partagent la même infra
- `maxDuration=300s` = marge ×10 par rapport au besoin réel (~28s)
- Le pipeline parallèle (5 RSS simultanés) est implémenté — pas de risque timeout même avec 60s default

**Pipeline parallélisé** (`PARALLEL_RSS_CONCURRENCY=5`) :
- 9 batches de 5 sources au lieu de 43 appels séquentiels
- Batch OpenAlex cross-sources : tous les DOIs sans abstract en un seul appel
- Réduction : 88s → 28s

## 12. Architecture cron (Vercel Pro requis)

```
Vercel Cron — 6h00 UTC chaque matin
        │
        ▼  GET /api/cron/veille  (Authorization: Bearer CRON_SECRET)
        │  maxDuration = 300s
        │
        ▼  runVeillePipeline(runId)  ← synchrone, pas fire-and-forget
        │
        └─ Résultat loggé dans Vercel : {ok, run_id, stats}
```

**Différence cron vs déclenchement manuel :**
- Manuel (`POST /api/veille/scrape`) → fire-and-forget, retourne immédiatement, status via polling
- Cron (`GET /api/cron/veille`) → synchrone, Vercel attend la fin, log le résultat

**Timeout :**
- `maxDuration = 300` dans la route → Vercel Pro requis (Hobby = 10s, Pro = jusqu'à 300s)
- Un run quotidien normal (filtre 7 jours) prend < 60s en pratique
