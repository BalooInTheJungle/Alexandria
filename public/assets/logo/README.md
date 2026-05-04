# Logos Alexandria

Dépose tes fichiers logo dans ce dossier.

## Utilisation

Pour afficher le logo dans un composant Next.js :

```tsx
import Image from "next/image";

// Logo principal
<Image src="/assets/logo/logo.svg" alt="Alexandria" width={120} height={40} />

// Avec dimensions flexibles
<Image src="/assets/logo/logo.png" alt="Alexandria" width={200} height={80} className="h-10 w-auto" />
```

## Fichiers recommandés

- `logo.svg` – logo principal (vectoriel, idéal pour le web)
- `logo.png` – fallback ou favicon
- `favicon.ico` – icône de l’onglet (ou ajouter dans `app/`)
