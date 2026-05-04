# Typographie Alexandria

## Ce que tu dois faire

### 1. Fournir la police

Indique quelle police tu utilises :
- **Google Fonts** : donne le nom (ex. "Inter", "Poppins") → on l’ajoute dans `app/layout.tsx`
- **Police locale** : place les fichiers `.woff2` ou `.ttf` dans `public/assets/fonts/` → on configure le chargement

### 2. Intégration (une fois la police connue)

#### Option A – Google Fonts

Dans `app/layout.tsx` :

```tsx
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({ children }) {
  return (
    <html lang="fr" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
```

Et dans `tailwind.config.ts` :

```ts
fontFamily: {
  sans: ["var(--font-sans)", "sans-serif"],
}
```

Avec `--font-sans` défini dans le layout.

#### Option B – Police locale

1. Crée `public/assets/fonts/` et dépose tes fichiers
2. Dans `app/globals.css` :

```css
@font-face {
  font-family: "MaPolice";
  src: url("/assets/fonts/ma-police.woff2") format("woff2");
  font-weight: 400 700;
  font-display: swap;
}
```

3. Dans `tailwind.config.ts` :

```ts
fontFamily: {
  sans: ["MaPolice", "sans-serif"],
}
```

---

## Récap

Envoie le nom de la police (ou le lien Google Fonts) et on fera l’intégration. Pour l’instant, la typo par défaut du navigateur est utilisée.
