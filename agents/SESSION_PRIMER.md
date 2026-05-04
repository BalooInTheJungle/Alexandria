# SESSION PRIMER — Agent de démarrage

À charger au début de chaque session Claude Code sur Alexandria.
Donne le contexte minimal pour travailler efficacement sans re-expliquer.

---

## Rappel du projet

Alexandria = outil RAG + veille pour un chercheur CNRS (Molecular Materials & Magnetism).
- RAG : interroger ~10 000 articles PDF en FR/EN
- Veille : scraper 43 journaux, scorer les nouveaux articles par similarité

Stack : Next.js 14, Supabase (Postgres + pgvector), OpenAI gpt-4o-mini, Vercel.

---

## Checklist de démarrage

Avant de commencer à coder, vérifier :

1. **Lire `context/PRIMER.md`** — état actuel du projet (ce qui marche, ce qui ne marche pas)
2. **Lire `context/SESSION_LOG.md`** — dernière session (où on en était, ce qui reste à faire)
3. **Consulter `docs/ROADMAP.md`** si la tâche concerne une nouvelle fonctionnalité

---

## Règles de travail (rappel)

- Un fichier à la fois, une fonctionnalité à la fois
- Proposer le plan (liste numérotée) et attendre la validation
- Logs obligatoires sur chaque fonction lib/ et chaque API route
- Répondre en français dans le terminal

---

## Contraintes critiques à ne jamais oublier

| Contrainte | Détail |
|-----------|--------|
| `vector(384)` fixe | Ne jamais changer la dimension des embeddings |
| Triggers Postgres | Ne pas écrire dans `content_tsv` / `content_fr_tsv` |
| Client admin | Uniquement pour cron/ et ingestion/ (bypasse RLS) |
| `.env.local` | Ne jamais committer |
| `data/pdfs/` | Ne jamais committer (jusqu'à ~100 Go) |

---

## Commandes de démarrage rapide

```bash
# Lancer le projet en local
npm run dev

# Vérifier les logs en temps réel (Vercel)
vercel logs --follow

# Tester la pipeline veille
npx tsx scripts/test-veille.ts

# Appliquer une migration
npx supabase db push
```

---

## Où trouver quoi

| Question | Où chercher |
|----------|-------------|
| Comment fonctionne le RAG ? | `docs/ARCHITECTURE.md` + `documentation/BACK_RAG.md` |
| Schéma de la DB ? | `docs/ARCHITECTURE.md` + `documentation/SCHEMA_DB_ET_DONNEES.md` |
| Quelles fonctionnalités restent à faire ? | `docs/ROADMAP.md` |
| Erreur connue ? | `docs/ERRORS.md` |
| Terme inconnu ? | `docs/GLOSSARY.md` |
| Décision technique passée ? | `docs/DECISIONS.md` |

---

## En fin de session

1. Mettre à jour `context/PRIMER.md` si l'état du projet a changé
2. Ajouter une entrée dans `context/SESSION_LOG.md`
3. Mettre à jour `docs/ROADMAP.md` si un jalon est atteint
4. Mettre à jour `docs/ERRORS.md` si une erreur a été rencontrée et résolue
