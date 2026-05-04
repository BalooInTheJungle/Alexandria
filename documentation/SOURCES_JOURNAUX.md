# Sources journaux — Alexandria Veille

**Rôle** : liste de référence des 47 journaux à surveiller, avec ISSN, URL RSS et stratégie d'extraction. Ce fichier sert à alimenter la table `sources` en base.

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

---

## Wiley / Chemistry Europe (8 journaux)

Pattern RSS Wiley : `https://onlinelibrary.wiley.com/action/showFeed?jc=CODE&type=etoc&feed=rss`

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Angewandte Chemie Int. Ed. | 1521-3773 | https://onlinelibrary.wiley.com/action/showFeed?jc=15213773&type=etoc&feed=rss | ✅ |
| Chemistry – A European Journal | 1521-3765 | https://onlinelibrary.wiley.com/action/showFeed?jc=15213765&type=etoc&feed=rss | ✅ |
| European Journal of Inorganic Chemistry | 1099-0682 | https://onlinelibrary.wiley.com/action/showFeed?jc=10990682&type=etoc&feed=rss | ✅ |
| Advanced Materials | 1521-4095 | https://onlinelibrary.wiley.com/action/showFeed?jc=15214095&type=etoc&feed=rss | ✅ |
| Advanced Functional Materials | 1616-3028 | https://onlinelibrary.wiley.com/action/showFeed?jc=16163028&type=etoc&feed=rss | ✅ |
| Small | 1613-6829 | https://onlinelibrary.wiley.com/action/showFeed?jc=16136829&type=etoc&feed=rss | ✅ |
| ChemistryEurope | 2751-4765 | https://onlinelibrary.wiley.com/action/showFeed?jc=27514765&type=etoc&feed=rss | ⚠️ |
| Materials Today | 1369-7021 | https://onlinelibrary.wiley.com/action/showFeed?jc=13697021&type=etoc&feed=rss | ⚠️ |

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

## MDPI (2 journaux — Open Access)

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Magnetochemistry | 2312-7481 | https://www.mdpi.com/rss/journal/magnetochemistry | ✅ |
| Inorganics | 2304-6740 | https://www.mdpi.com/rss/journal/inorganics | ✅ |

---

## AAAS / NAS (2 journaux)

| Journal | ISSN (e) | RSS URL | Statut |
|---|---|---|---|
| Science | 1095-9203 | https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science | ⚠️ |
| PNAS | 1091-6490 | https://www.pnas.org/action/showFeed?type=etoc&feed=rss&jc=pnas | ⚠️ |

---

## Récapitulatif

| Éditeur | Nb journaux | Stratégie | Statut |
|---|---|---|---|
| ACS | 12 | RSS | ✅ confirmé |
| RSC | 10 | RSS | ✅ confirmé |
| Wiley | 8 | RSS | ✅ / ⚠️ à vérifier |
| Nature | 4 | RSS | ✅ confirmé |
| APS | 3 | RSS | ✅ confirmé |
| Elsevier | 5 | RSS (ScienceDirect) | ✅ confirmé |
| MDPI | 2 | RSS | ✅ confirmé |
| AAAS/NAS | 2 | RSS | ⚠️ à vérifier |
| **Total** | **46** | | |

---

## Prochaine étape : import en base

Ces données sont à insérer dans la table `sources` (Supabase).
Colonnes à ajouter : `issn`, `rss_url`, `source_type` (`rss` ou `openalex`), `publisher`.

Script d'import à créer : `scripts/import-sources.ts`
