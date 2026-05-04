# SKILL — Créer un composant Next.js

Recette pour créer un nouveau composant React dans Alexandria.
Stack : Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui.

---

## Checklist

- [ ] Identifier le dossier cible (`components/<module>/`)
- [ ] Choisir : composant client (`'use client'`) ou serveur (pas de directive)
- [ ] Utiliser les composants `ui/` existants (shadcn)
- [ ] Props typées en TypeScript
- [ ] Pas de logique métier dans le composant (uniquement affichage)
- [ ] Nommer en PascalCase : `MonComposant.tsx`

---

## Règle de décision client vs serveur

| Le composant... | Type |
|----------------|------|
| Utilise `useState`, `useEffect`, `useRef` | Client → `'use client'` |
| Gère des events (`onClick`, `onChange`) | Client → `'use client'` |
| Affiche seulement des données passées en props | Serveur (pas de directive) |
| Fait un fetch côté serveur | Serveur (pas de directive) |

---

## Template composant client

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MonComposantProps {
  titre: string
  items: Array<{ id: string; label: string }>
  onSelect: (id: string) => void
}

export function MonComposant({ titre, items, onSelect }: MonComposantProps) {
  const [selected, setSelected] = useState<string | null>(null)

  function handleSelect(id: string) {
    setSelected(id)
    onSelect(id)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <Button
            key={item.id}
            variant={selected === item.id ? 'default' : 'outline'}
            onClick={() => handleSelect(item.id)}
            className="w-full justify-start"
          >
            {item.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
```

---

## Template composant serveur (affichage seul)

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MonComposantProps {
  titre: string
  description: string
  score?: number
}

export function MonComposant({ titre, description, score }: MonComposantProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{titre}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
        {score !== undefined && (
          <p className="mt-2 text-xs text-muted-foreground">
            Score : {(score * 100).toFixed(1)}%
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

---

## Composants ui/ disponibles (shadcn)

| Composant | Import | Usage |
|-----------|--------|-------|
| `Button` | `@/components/ui/button` | Boutons avec variants (default, outline, ghost) |
| `Card`, `CardContent`, `CardHeader`, `CardTitle` | `@/components/ui/card` | Conteneurs carte |
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` | `@/components/ui/dialog` | Modales |
| `Input` | `@/components/ui/input` | Champs de saisie |
| `Label` | `@/components/ui/label` | Labels de formulaire |
| `ScrollArea` | `@/components/ui/scroll-area` | Zone scrollable |
| `Textarea` | `@/components/ui/textarea` | Zone de texte multiline |

---

## Dossiers par module

| Module | Dossier |
|--------|---------|
| RAG (chat, sidebar, messages) | `components/rag/` |
| Veille (dashboard, cards articles) | `components/veille/` |
| Bibliographie (upload, liste docs) | `components/bibliographie/` |
| Layout (nav, sidebar globale) | `components/layout/` |
| Composants génériques | `components/ui/` (shadcn uniquement) |

---

## Utiliser le composant dans une page

```tsx
// app/(dashboard)/bibliographie/page.tsx
import { MonComposant } from '@/components/bibliographie/MonComposant'

export default function BibliographiePage() {
  return (
    <div className="p-6">
      <MonComposant
        titre="Titre"
        items={[]}
        onSelect={(id) => console.log(id)}
      />
    </div>
  )
}
```

---

## À ne pas faire

- Mettre de la logique métier (calculs, appels API) dans un composant
- Utiliser `fetch()` côté client pour des données protégées (passer par les API routes)
- Créer des composants ui/ custom si shadcn a déjà le composant
- Oublier de typer les props en TypeScript
