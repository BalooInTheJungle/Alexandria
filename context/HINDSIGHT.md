# HINDSIGHT — Profil de travail

Ce fichier décrit comment travailler efficacement avec ce projet et son porteur.
À lire en début de session pour adapter le style de collaboration.

---

## Profil utilisateur

| Attribut | Description |
|----------|-------------|
| **Rôle** | Porteur du projet, non-développeur |
| **Stack** | Comprend l'architecture globale, pas à l'aise pour écrire du code |
| **Workflow** | Idée → structure/diagrammes → documentation → développe sur doc → test → met à jour doc |
| **Tests** | Clique dans l'UI et lit les logs navigateur (front) + logs Vercel (back) |
| **Langue** | Répond en français, lit l'anglais technique |

---

## Comment collaborer efficacement

### Ce qui fonctionne
- **Découper en petites étapes** et attendre validation avant de continuer
- **Proposer le plan** (liste numérotée) avant d'implémenter quoi que ce soit
- **Expliquer les décisions** avec des analogies concrètes, pas de jargon bas niveau
- **Un fichier à la fois** — jamais plusieurs fichiers en parallèle sans discussion
- **Confirmer à chaque étape** : "Étape X terminée, on passe à Y ?"

### Ce qui ne fonctionne pas
- Tout implémenter d'un coup sans validation intermédiaire
- Expliquer les détails d'implémentation de bas niveau (algorithmes, optimisations internes)
- Modifier plusieurs fichiers en chaîne sans checkpoint
- Donner trop d'options sans recommandation claire

---

## Règles de développement apprises

### Logs obligatoires partout
Chaque fonction dans `lib/` et chaque API route doit avoir :
```ts
console.log('[nomFonction] input:', { ... })
console.log('[nomFonction] result:', { ... })
console.error('[nomFonction] error:', error)
```
Raison : l'utilisateur débogue exclusivement via les logs Vercel et navigateur.

### Petits blocs d'implémentation
Ne jamais implémenter plus d'un fichier à la fois sans validation.
Raison : évite les blocages et les incompréhensions qui nécessitent de tout défaire.

### Ne pas modifier la dimension des vecteurs
`chunks.embedding` et `chunks.embedding_fr` sont `vector(384)`. Toute modification casserait tous les chunks existants.

---

## Patterns récurrents du projet

### Ajouter une nouvelle API route
1. Créer `app/api/<module>/<route>/route.ts`
2. Ajouter les fonctions DB dans `lib/db/<module>.ts`
3. Logger input/output/error sur chaque fonction
4. Tester avec curl ou l'UI

### Ajouter un nouveau composant
1. Créer dans `components/<module>/NomComposant.tsx`
2. Utiliser les composants `ui/` existants (shadcn)
3. Props typées en TypeScript
4. Pas de logique métier dans les composants (uniquement dans les API routes ou lib/)

### Ajouter une migration Supabase
1. Nommer : `YYYYMMDDHHMMSS_description.sql`
2. Appliquer avec `npx supabase db push`
3. Mettre à jour `docs/ARCHITECTURE.md` si le schéma change
4. Mettre à jour `lib/db/types.ts` si de nouveaux types sont nécessaires

---

## Ce qu'il ne faut jamais faire

- Écrire directement dans `content_tsv` ou `content_fr_tsv` (triggers Postgres)
- Utiliser le client admin Supabase dans une route accessible par l'utilisateur (seulement cron/ingestion)
- Changer la dimension des embeddings (vector 384D fixe)
- Committer `.env.local` (secrets)
- Committer les PDFs dans `data/pdfs/` (potentiellement ~100 Go)

---

## Références
- `context/PRIMER.md` — état actuel du projet
- `docs/DECISIONS.md` — décisions techniques et leurs raisons
- `docs/ERRORS.md` — erreurs fréquentes et solutions
