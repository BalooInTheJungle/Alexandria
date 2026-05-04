# SKILL — Ajouter une source de veille

Recette pour ajouter un nouveau journal scientifique à la pipeline de veille Alexandria.
Deux types de sources : **RSS** (majorité des journaux) ou **OpenAlex** (MDPI et similaires sans RSS).

---

## Checklist

- [ ] Trouver le type de source : RSS ou OpenAlex ?
- [ ] Récupérer les informations nécessaires (voir ci-dessous)
- [ ] Ajouter l'entrée dans `scripts/import-sources.ts`
- [ ] Relancer le script d'import
- [ ] Vérifier en base que la source est bien insérée
- [ ] Mettre à jour `documentation/SOURCES_JOURNAUX.md` si pertinent

---

## Informations nécessaires

### Pour une source RSS

| Champ | Comment trouver |
|-------|----------------|
| `name` | Nom complet du journal |
| `publisher` | Éditeur (ACS, RSC, Wiley, Nature, Elsevier, etc.) |
| `issn` | ISSN en ligne — chercher sur le site du journal ou ISSN.org |
| `rss_url` | URL du flux RSS — chercher le bouton RSS sur le site du journal |
| `url` | URL de la page principale du journal |
| `source_type` | `'rss'` |

**Trouver l'URL RSS :**
- ACS : `https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=<CODE_JOURNAL>`
- RSC : `https://pubs.rsc.org/en/rss/journal/<CODE>`
- Wiley : `https://onlinelibrary.wiley.com/action/showFeed?jc=<ISSN_sans_tiret>&type=etoc&feed=rss`
- Nature : `https://www.nature.com/<journal>/articles.rss`
- Elsevier : page du journal → onglet RSS

### Pour une source OpenAlex (sans RSS)

| Champ | Comment trouver |
|-------|----------------|
| `name` | Nom complet du journal |
| `publisher` | Éditeur |
| `issn` | ISSN en ligne |
| `url` | URL du journal |
| `source_type` | `'openalex'` |
| `rss_url` | `null` |

---

## Ajouter dans import-sources.ts

Ouvrir `scripts/import-sources.ts` et ajouter une ligne dans le tableau `SOURCES` :

```typescript
// Dans le tableau SOURCES, ajouter dans la section de l'éditeur concerné :

// Source RSS
{ 
  name: 'Nom du journal', 
  publisher: 'Éditeur', 
  issn: '0000-0000',
  rss_url: 'https://url-du-flux-rss.com/feed',
  source_type: 'rss',
  url: 'https://url-du-journal.com'
},

// Source OpenAlex (sans RSS)
{ 
  name: 'Nom du journal',
  publisher: 'Éditeur',
  issn: '0000-0000',
  rss_url: null,
  source_type: 'openalex',
  url: 'https://url-du-journal.com'
},
```

---

## Relancer le script d'import

```bash
# Depuis la racine du projet
npx tsx scripts/import-sources.ts
```

Le script fait un **upsert** sur la colonne `issn` : si la source existe déjà, elle est mise à jour. Si elle est nouvelle, elle est créée avec `active = true` par défaut.

---

## Vérifier en base

```sql
-- Vérifier que la source a bien été insérée
SELECT id, name, publisher, source_type, active
FROM sources
WHERE issn = '0000-0000';  -- remplacer par le bon ISSN

-- Voir toutes les sources actives
SELECT name, publisher, source_type, COUNT(*) OVER () as total
FROM sources
WHERE active = true
ORDER BY publisher, name;
```

---

## Désactiver une source

Pour désactiver une source sans la supprimer (ex. journal fermé, RSS cassé) :

```sql
UPDATE sources SET active = false WHERE issn = '0000-0000';
```

Ou ajouter la propriété `active: false` dans l'entrée de `import-sources.ts` et relancer le script.

---

## Tester la nouvelle source

```bash
# Lancer un test de la pipeline veille (inclut la nouvelle source)
npx tsx scripts/test-veille.ts
```

Vérifier dans les logs que la nouvelle source est bien scrapée et que des articles sont récupérés.

---

## Formats RSS par éditeur (référence)

| Éditeur | Format URL RSS |
|---------|---------------|
| ACS | `https://pubs.acs.org/action/showFeed?type=axatoc&feed=rss&jc=<CODE>` |
| RSC | `https://pubs.rsc.org/en/rss/journal/<CODE>` |
| Wiley | `https://onlinelibrary.wiley.com/action/showFeed?jc=<ISSN_sans_tiret>&type=etoc&feed=rss` |
| Nature | `https://www.nature.com/<journal>/articles.rss` |
| Elsevier | Variable selon le journal, chercher sur le site |
| APS | `https://journals.aps.org/rss/<JOURNAL>.xml` |
| MDPI | Pas de RSS fiable → utiliser OpenAlex |

---

## Références

- `scripts/import-sources.ts` — script d'upsert des sources
- `documentation/SOURCES_JOURNAUX.md` — liste complète des journaux actuels
- `lib/veille/sources.ts` — lecture des sources depuis Supabase
- `documentation/PIPELINE_VEILLE_CONSOLIDE.md` — pipeline veille détaillée
