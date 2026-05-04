# SPEC — Page Sources de veille

Spec complète pour la prochaine session de développement.
Objectif : permettre au chercheur de gérer les 43 sources de veille depuis l'UI.

---

## Pourquoi cette page

Aujourd'hui les sources se gèrent uniquement via `scripts/import-sources.ts` (script terminal).
Le chercheur doit pouvoir :
- Voir les 43 sources actives (et leur état)
- Désactiver une source temporairement (ex. RSS cassé, journal hors domaine)
- Ajouter un nouveau journal sans passer par un script

---

## Plan d'implémentation (dans l'ordre)

### Étape 1 — Migration SQL

Fichier : `supabase/migrations/YYYYMMDDHHMMSS_sources_active.sql`

```sql
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_sources_active ON public.sources (active);

-- Activer toutes les sources existantes
UPDATE public.sources SET active = true WHERE active IS NULL;
```

Appliquer : `npx supabase db push`

---

### Étape 2 — Mettre à jour lib/veille/sources.ts

Ajouter `.eq('active', true)` dans `getRssSources()` et `getOpenAlexSources()` :

```ts
// getRssSources — ajouter .eq('active', true)
const { data, error } = await supabase
  .from('sources')
  .select('id, name, publisher, issn, rss_url')
  .eq('source_type', 'rss')
  .eq('active', true)          // ← ajouter
  .not('rss_url', 'is', null)

// getOpenAlexSources — idem
const { data, error } = await supabase
  .from('sources')
  .select('id, name, publisher, issn')
  .eq('source_type', 'openalex')
  .eq('active', true)          // ← ajouter
  .not('issn', 'is', null)
```

---

### Étape 3 — lib/db/sources.ts

Créer les fonctions DB dans `lib/db/sources.ts` (actuellement vide) :

```ts
// Fonctions à implémenter :
// getSources()         → toutes les sources, triées publisher + name
// toggleSourceActive() → PATCH active sur un id
// addSource()          → INSERT une nouvelle source
```

Types à ajouter dans `lib/db/types.ts` :
```ts
export interface Source {
  id: string
  name: string
  publisher: string | null
  issn: string | null
  url: string
  rss_url: string | null
  source_type: 'rss' | 'openalex'
  active: boolean
  created_at: string
  last_checked_at: string | null
}
export type SourceInsert = Omit<Source, 'id' | 'created_at' | 'last_checked_at'>
```

---

### Étape 4 — API routes

**`app/api/veille/sources/route.ts`** — GET + POST

```
GET  /api/veille/sources        → liste toutes les sources (active ou non)
POST /api/veille/sources        → ajouter une nouvelle source
```

**`app/api/veille/sources/[id]/route.ts`** — PATCH

```
PATCH /api/veille/sources/[id]  → body: { active: boolean } — toggle
```

Contraintes :
- Auth obligatoire sur toutes les routes
- Utiliser `lib/supabase/server.ts` (pas admin)
- Logger input/output/error sur chaque handler

---

### Étape 5 — Page `/bibliographie/sources`

Fichier : `app/(dashboard)/bibliographie/sources/page.tsx`

**Layout de la page :**

```
┌─────────────────────────────────────────────────────────────┐
│ Sources de veille          [+ Ajouter une source]           │
│ 43 sources — 43 actives                                      │
├─────────────────────────────────────────────────────────────┤
│ Filtres : [Tous éditeurs ▼]  [Actives seulement ☐]          │
├─────────────────────────────────────────────────────────────┤
│ ACS                                                          │
│  ● JACS          RSS   0000-0001  [Activer/Désactiver]      │
│  ● Inorg. Chem.  RSS   0000-0002  [Activer/Désactiver]      │
│ RSC                                                          │
│  ● Dalton Trans. RSS   0000-0003  [Activer/Désactiver]      │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

**Comportement :**
- Sources groupées par `publisher`
- Toggle active/inactive avec feedback immédiat (optimistic update)
- Sources inactives : opacité réduite + badge "Désactivée"
- Bouton "+ Ajouter" ouvre un Dialog (formulaire simple)

---

### Étape 6 — Formulaire d'ajout (Dialog)

Champs :
| Champ | Type | Obligatoire | Notes |
|-------|------|-------------|-------|
| Nom du journal | text | ✅ | Ex : "Journal of the American Chemical Society" |
| Éditeur | text | non | Ex : "ACS" |
| ISSN | text | non | Format : XXXX-XXXX |
| URL du journal | text | ✅ | Page principale |
| URL RSS | text | non | Vide → source_type = 'openalex' |

Logique : si `rss_url` renseigné → `source_type = 'rss'`, sinon → `source_type = 'openalex'`

Validation minimale : `name` et `url` non vides. Pas besoin de valider le format ISSN.

---

### Étape 7 — Lien dans la navigation

Dans `app/(dashboard)/layout.tsx`, ajouter "Sources" dans la nav :

```tsx
// Après le lien Bibliographie existant :
<span className="text-white/30 text-xs">|</span>
<Button variant="ghost" asChild ...>
  <Link href="/bibliographie/sources">Sources</Link>
</Button>
```

---

## Ce que cette page n'a PAS besoin de faire (pour l'instant)

- Pas d'édition inline des champs (nom, ISSN, RSS URL) — seulement toggle + ajout
- Pas de suppression de source — désactiver suffit
- Pas de stats par source (nombre d'articles trouvés) — V2
- Pas de test RSS "en live" — V2

---

## Fichiers à créer / modifier

| Action | Fichier |
|--------|---------|
| Créer | `supabase/migrations/YYYYMMDDHHMMSS_sources_active.sql` |
| Modifier | `lib/veille/sources.ts` (+ `.eq('active', true)`) |
| Remplir | `lib/db/sources.ts` (fonctions DB) |
| Modifier | `lib/db/types.ts` (type Source) |
| Créer | `app/api/veille/sources/route.ts` |
| Créer | `app/api/veille/sources/[id]/route.ts` |
| Créer | `app/(dashboard)/bibliographie/sources/page.tsx` |
| Modifier | `app/(dashboard)/layout.tsx` (lien nav) |

**Total : 2 modifications + 5 créations = 7 fichiers, une étape à la fois.**

---

## Références

- `lib/veille/sources.ts` — fonctions existantes à modifier
- `scripts/import-sources.ts` — structure des données sources (43 journaux)
- `supabase/migrations/20260207100000_sources_rss.sql` — schéma actuel de la table sources
- `skills/add-veille-source.md` — recette pour ajouter une source manuellement
