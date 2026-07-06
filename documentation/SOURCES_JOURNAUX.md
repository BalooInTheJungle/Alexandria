# Sources journaux — Alexandria Veille

**Rôle** : liste de référence des journaux surveillés, avec ISSN, URL RSS et stratégie d'extraction. Ce fichier a servi à peupler la table `sources` en base via `scripts/import-sources.ts`.

> Vérifié en base réelle le 06/07/2026 (requête directe Supabase, projet `whxnsqlrqjdrpjqlshvu`) : **49 sources actives**, pas 47 — `scripts/import-sources.ts` (45 entrées) est **désynchronisé** de la base, qui a été complétée manuellement depuis (UI "Ajouter une source" + modifications directes). Détail des écarts trouvés :
> - **RSC compte 11 journaux, pas 10** : *Physical Chemistry Chemical Physics* (ISSN 1463-9084) a été ajouté le 2026-05-06, absent du script d'import.
> - **Wiley compte 7 journaux, pas 8** : *Materials Today* listé ci-dessous sous Wiley est une erreur de cette doc — en base il n'existe que sous Elsevier (RSS ScienceDirect), pas en doublon Wiley.
> - **MDPI (Magnetochemistry, Inorganics)** : `source_type = 'openalex'` en base (fetch par ISSN via `getOpenAlexSources()`), **pas** `'rss'` comme les insère `scripts/import-sources.ts` — ce champ a été changé manuellement après le seed initial.
> - **2 sources orphelines** ajoutées via l'UI le 2026-04-08, `publisher = NULL`, **`rss_url = NULL`** : *"Science Direct"* et *"Chemistry Europe"*. Comme `getRssSources()` filtre `.not('rss_url', 'is', null)`, ces deux sources sont `active = true` en base mais **ne remontent jamais aucun article** — mortes silencieusement, sans erreur visible dans le pipeline.
> - Il existe aussi 1 source `source_type = 'semantic_scholar'` (Job 1b), sans ISSN ni RSS, non listée dans les tableaux ci-dessous.
>
> **Total réel** : 46 `rss` (44 "normales" + 2 orphelines mortes) + 2 `openalex` (MDPI) + 1 `semantic_scholar` = **49**, dont **47 effectivement fonctionnelles**.

**Légende statut RSS :**
- ✅ URL RSS confirmée (pattern éditeur documenté)
- ⚠️ URL RSS à vérifier manuellement
- 🔵 Pas de RSS fiable → fallback OpenAlex par ISSN

---

## ACS Publications (12 journaux)

Pattern RSS ACS : `https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=CODE`

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Journal of the American Chemical Society | 1520-5126 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jacsat | ✅ |
| Chemistry of Materials | 1520-5002 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=cmatex | ✅ |
| Inorganic Chemistry | 1520-510X | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=inocaj | ✅ |
| ACS Nano | 1936-086X | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=ancac3 | ✅ |
| Crystal Growth & Design | 1528-7505 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=cgdefu | ✅ |
| ACS Applied Materials & Interfaces | 1944-8252 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=aamick | ✅ |
| ACS Applied Optical Materials | 2771-9855 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=aaoma6 | ✅ |
| Nano Letters | 1530-6992 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=nalefd | ✅ |
| Journal of Physical Chemistry Letters | 1948-7185 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=jpclcd | ✅ |
| ACS Central Science | 2374-7951 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=acscii | ✅ |
| Chemical Reviews | 1520-6890 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=chreay | ✅ |
| Accounts of Chemical Research | 1520-4898 | https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=achre4 | ✅ |

---

## RSC — Royal Society of Chemistry (10 journaux)

Pattern RSS RSC : `https://pubs.rsc.org/en/rss/journal/CODE`

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Chemical Science | 2041-6539 | https://pubs.rsc.org/en/rss/journal/sc | ✅ |
| Chemical Communications | 1364-548X | https://pubs.rsc.org/en/rss/journal/cc | ✅ |
| Dalton Transactions | 1477-9234 | https://pubs.rsc.org/en/rss/journal/dt | ✅ |
| Journal of Materials Chemistry A | 2050-7496 | https://pubs.rsc.org/en/rss/journal/ta | ✅ |
| Journal of Materials Chemistry B | 2050-7504 | https://pubs.rsc.org/en/rss/journal/tb | ✅ |
| Journal of Materials Chemistry C | 2050-7526 | https://pubs.rsc.org/en/rss/journal/tc | ✅ |
| Inorganic Chemistry Frontiers | 2052-1553 | https://pubs.rsc.org/en/rss/journal/qi | ✅ |
| CrystEngComm | 1466-8033 | https://pubs.rsc.org/en/rss/journal/ce | ✅ |
| New Journal of Chemistry | 1369-9261 | https://pubs.rsc.org/en/rss/journal/nj | ✅ |
| Chemical Society Reviews | 1460-4744 | https://pubs.rsc.org/en/rss/journal/cs | ✅ |
| Physical Chemistry Chemical Physics *(ajouté 2026-05-06, absent du script d'import)* | 1463-9084 | http://feeds.rsc.org/rss/cp | ✅ |

---

## Wiley / Chemistry Europe (7 journaux — pas 8)

Pattern RSS Wiley : `https://onlinelibrary.wiley.com/action/showFeed?jc=CODE&type=etoc&feed=rss`

> "Materials Today" a été retiré de cette liste : en base il n'existe que sous **Elsevier** (RSS ScienceDirect), il n'y a pas d'entrée Wiley dupliquée pour ce journal.

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Angewandte Chemie Int. Ed. | 1521-3773 | https://onlinelibrary.wiley.com/action/showFeed?jc=15213773&type=etoc&feed=rss | ✅ |
| Chemistry – A European Journal | 1521-3765 | https://onlinelibrary.wiley.com/action/showFeed?jc=15213765&type=etoc&feed=rss | ✅ |
| European Journal of Inorganic Chemistry | 1099-0682 | https://onlinelibrary.wiley.com/action/showFeed?jc=10990682&type=etoc&feed=rss | ✅ |
| Advanced Materials | 1521-4095 | https://onlinelibrary.wiley.com/action/showFeed?jc=15214095&type=etoc&feed=rss | ✅ |
| Advanced Functional Materials | 1616-3028 | https://onlinelibrary.wiley.com/action/showFeed?jc=16163028&type=etoc&feed=rss | ✅ |
| Small | 1613-6829 | https://onlinelibrary.wiley.com/action/showFeed?jc=16136829&type=etoc&feed=rss | ✅ |
| ChemistryEurope | 2751-4765 | https://onlinelibrary.wiley.com/action/showFeed?jc=27514765&type=etoc&feed=rss | ⚠️ |

---

## Nature Portfolio (4 journaux)

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Nature Chemistry | 1755-4349 | https://www.nature.com/nchem.rss | ✅ |
| Nature Materials | 1476-4660 | https://www.nature.com/nmat.rss | ✅ |
| Nature Communications | 2041-1723 | https://www.nature.com/ncomms.rss | ✅ |
| npj Quantum Materials | 2397-4648 | https://www.nature.com/npjquantmats.rss | ✅ |

---

## APS — American Physical Society (3 journaux)

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Physical Review B | 2469-9969 | https://feeds.aps.org/rss/recent/prb.xml | ✅ |
| Physical Review Letters | 1079-7114 | https://feeds.aps.org/rss/recent/prl.xml | ✅ |
| Physical Review Materials | 2475-9953 | https://feeds.aps.org/rss/recent/prmaterials.xml | ✅ |

---

## Elsevier / ScienceDirect (5 journaux)

Pattern RSS Elsevier : `https://rss.sciencedirect.com/publication/science/ISSN_PRINT`

| Journal | ISSN (print) | RSS URL | Statut |
|---|---|---|---|
| Coordination Chemistry Reviews | 0010-8545 | https://rss.sciencedirect.com/publication/science/00108545 | ✅ |
| Journal of Magnetism and Magnetic Materials | 0304-8853 | https://rss.sciencedirect.com/publication/science/03048853 | ✅ |
| Polyhedron | 0277-5387 | https://rss.sciencedirect.com/publication/science/02775387 | ✅ |
| Inorganica Chimica Acta | 0020-1693 | https://rss.sciencedirect.com/publication/science/00201693 | ✅ |
| Materials Today | 1369-7021 | https://rss.sciencedirect.com/publication/science/13697021 | ✅ |

---

## MDPI (2 journaux — Open Access, fetch OpenAlex par ISSN, pas RSS)

> En base, `source_type = 'openalex'` pour ces 2 sources : le pipeline les récupère via `getOpenAlexSources()` + `fetchRecentByIssn()` (fetch direct par ISSN), **pas** en parsant le flux RSS ci-dessous — même si l'URL RSS reste renseignée en base (probablement conservée pour référence/fallback manuel).

| Journal | ISSN (e) | RSS URL (non utilisée par le pipeline) | Statut |
|---|---|---|---|
| Magnetochemistry | 2312-7481 | https://www.mdpi.com/rss/journal/magnetochemistry | ✅ (via OpenAlex) |
| Inorganics | 2304-6740 | https://www.mdpi.com/rss/journal/inorganics | ✅ (via OpenAlex) |

---

## AAAS / NAS (2 journaux)

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Science | 1095-9203 | https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science | ⚠️ |
| PNAS | 1091-6490 | https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas | ⚠️ |

---

## Récapitulatif (base réelle, 06/07/2026)

| Éditeur | Nb journaux | Stratégie | Statut |
|---|---|---|---|
| ACS | 12 | RSS | ✅ confirmé |
| RSC | **11** (dont PCCP, hors script d'import) | RSS | ✅ confirmé |
| Wiley | **7** | RSS | ✅ / ⚠️ à vérifier |
| Nature | 4 | RSS | ✅ confirmé |
| APS | 3 | RSS | ✅ confirmé |
| Elsevier | 5 | RSS (ScienceDirect) | ✅ confirmé |
| MDPI | 2 | **OpenAlex** (pas RSS) | ✅ confirmé |
| AAAS/NAS | 2 | RSS | ⚠️ à vérifier |
| *(orphelines, `publisher` NULL)* | **2** | RSS **cassées** (`rss_url` NULL) | ❌ ne remontent jamais rien |
| Semantic Scholar | 1 | API recommandations (Job 1b) | ✅ (non listé ci-dessus) |
| **Total en base** | **49** | | **47 réellement fonctionnelles** |

---

## Import initial (historique)

Le script `scripts/import-sources.ts` (45 entrées) a servi au peuplement initial de la table `sources`. La base a ensuite divergé (ajouts UI, corrections manuelles de `source_type`) — voir l'encart en tête de document. **Ne pas considérer ce script comme reflétant l'état actuel de la table `sources`** ; pour un état à jour, interroger directement la base (`select * from sources`).
