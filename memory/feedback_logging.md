---
name: Convention logs et debug
description: Toujours ajouter des logs sur les fonctions et appels API pour faciliter le debug
type: feedback
---

Toujours ajouter des logs explicites sur les fonctions critiques et les appels API (entrées, sorties, erreurs).

**Why:** L'utilisateur ne code pas lui-même — il doit pouvoir diagnostiquer les bugs uniquement depuis les logs sans lire le code. Les logs sont son principal outil de debug.

**How to apply:** Sur chaque fonction de `lib/`, chaque API route et chaque appel externe (Supabase, OpenAI, embeddings) : log au début (paramètres reçus), log à la fin (résultat ou statut), log sur chaque branche d'erreur avec le message complet. Utiliser `console.log` / `console.error` avec un préfixe identifiant la fonction (ex. `[searchChunks]`, `[/api/rag/chat]`).
