# SPEC — Module Lecture Assistée

## Contexte

Sondage mené auprès de 39 chercheurs (doctorants + enseignants-chercheurs) :
- **46%** citent la lecture et synthèse comme activité la plus chronophage
- **95%** ratent des publications importantes faute de temps
- **62%** font leur veille manuellement
- **36%** passent trop de temps à trier et filtrer

Le module Veille identifie les articles pertinents. Le module Lecture assistée aide à les lire.

---

## Architecture existante réutilisable

| Composant | Fichier | Usage dans Lecture assistée |
|-----------|---------|----------------------------|
| Embedding Xenova 384D | `lib/rag/embed.ts` → `embedQuery()` | Embedder l'abstract → match_chunks |
| RPC match_chunks | Supabase | Trouver les chunks corpus les plus proches |
| OpenAlex API | `lib/veille/openalex.ts` | Autres publications du même auteur |
| GPT-4o-mini | `lib/rag/openai.ts` | Résumés structurés |
| Upload PDF | `app/api/documents/upload/` | Ingestion PDF ponctuel |
| Pipeline chunking | `lib/ingestion/` | Réutilisé pour le PDF uploadé |

**Point critique** : utiliser `all-MiniLM-L6-v2` (Xenova) partout — même modèle que le corpus → vecteurs comparables.

---

## Fonctionnalités

### Niveau 1 — Abstract (toujours disponible, sans upload)

| Feature | Implémentation | Priorité |
|---------|---------------|----------|
| Résumé structuré (Problème / Méthode / Résultats / Apport) | GPT-4o-mini sur abstract | P1 |
| Chunks corpus les plus proches | `embedQuery(abstract)` → `match_chunks` RPC | P1 |
| Autres publications du même auteur | OpenAlex `/author` endpoint | P1 |
| Label thématique / cluster | GPT sur les titres des chunks similaires trouvés | P2 |

### Niveau 2 — PDF uploadé par le chercheur

| Feature | Implémentation | Priorité |
|---------|---------------|----------|
| Extraction + chunking + embedding | `/api/documents/upload` réutilisé, flag `is_reading_session` | P1 |
| Résumé complet par section (Intro / Méthodes / Résultats / Discussion) | GPT sur chunks nettoyés par section | P1 |
| Passages PDF les plus proches du corpus | `match_chunks` entre chunks nouveau PDF et corpus | P1 |
| Détection références citées dans le corpus | Regex section References → recoupement DOIs corpus | P2 |

---

## Décisions techniques à trancher

### 1. Pipeline embedding — réutilisation directe
`embedQuery(abstract)` dans `lib/rag/embed.ts` est utilisable tel quel.
Pas besoin d'une route dédiée — appeler depuis une Server Action ou une API route `/api/lecture/analyze`.

### 2. Nettoyage bruit PDF avant LLM
Le chunking par section de `ingest.py` est suffisant pour isoler Intro/Méthodes/Résultats/Discussion.
Stratégie recommandée : envoyer les chunks de la section cible au LLM, pas le PDF brut entier.
Filtrer les chunks avec `section_title IN ('Introduction', 'Methods', 'Results', 'Discussion')`.

### 3. Stockage chunks PDF ponctuel
**Option retenue : réutiliser `chunks` avec flag `is_reading_session=true`**
- Avantage : pipeline d'ingestion inchangé, `match_chunks` fonctionne immédiatement
- Contrainte : nettoyage périodique (TTL 7 jours sur `is_reading_session=true`)
- Alternative écartée : table dédiée `reading_chunks` → duplication du pipeline

### 4. Traitements longs sur Vercel
- **Résumé LLM** : streaming SSE (déjà en place pour le RAG) — max 30s Vercel OK
- **Embedding PDF complet** : chunker + embedder en une route `/api/lecture/ingest` avec streaming de progression
- Si timeout : Supabase Edge Function en background (option de secours)

---

## Routes API à créer

```
POST /api/lecture/analyze
  body: { veille_item_id: string }
  → résumé abstract + chunks proches + autres articles auteur
  → streaming SSE ou JSON selon complexité

POST /api/lecture/ingest
  body: { veille_item_id: string, file: File }
  → upload PDF → chunking → embedding → sauvegarde (is_reading_session=true)
  → retourne document_id pour /api/lecture/deep-analyze

GET  /api/lecture/deep-analyze?document_id=...
  → résumé sections + passages proches corpus + références détectées
```

---

## UI — Intégration dans la page Veille

**Entrée** : clic sur un article dans `VeilleArticleCard` → panel latéral ou page dédiée `/bibliographie/lecture/[item_id]`

**Layout panel Niveau 1** :
```
┌─ Score + badge source ─────────────────────────┐
│ Résumé structuré (4 lignes)                    │
│ ─────────────────────────────────────────────  │
│ 🔗 Articles corpus les plus proches (top 3)    │
│ 👤 Autres articles du même auteur              │
│ 🏷️  Thème : "Spin crossover / coordination"    │
│ ─────────────────────────────────────────────  │
│ [📄 Uploader le PDF pour analyse complète]     │
└────────────────────────────────────────────────┘
```

**Layout panel Niveau 2** (après upload) :
```
┌─ Résumé complet ───────────────────────────────┐
│ Introduction / Méthodes / Résultats / Disc.    │
│ ─────────────────────────────────────────────  │
│ 📌 Passages les plus proches de votre corpus  │
│ 📚 Références citées dans votre corpus (DOIs) │
└────────────────────────────────────────────────┘
```

---

## Migrations nécessaires

```sql
-- Flag pour distinguer les PDFs de session de lecture du corpus permanent
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_reading_session boolean DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_reading_session boolean DEFAULT false;

-- Index pour nettoyer les sessions expirées
CREATE INDEX IF NOT EXISTS idx_chunks_reading_session ON chunks (is_reading_session, created_at)
  WHERE is_reading_session = true;
```

---

## Ordre d'implémentation suggéré

1. Route `POST /api/lecture/analyze` (Niveau 1 — sans PDF)
2. Composant `LecturePanel` dans la page Veille (panel latéral)
3. Route `POST /api/lecture/ingest` + `GET /api/lecture/deep-analyze` (Niveau 2)
4. Extension du panel pour le Niveau 2
5. Migration TTL / nettoyage sessions
