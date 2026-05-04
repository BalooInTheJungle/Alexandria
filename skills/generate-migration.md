# SKILL — Créer une migration Supabase

Recette pour ajouter une migration SQL dans Alexandria.
Toujours appliquer dans l'ordre chronologique. Ne jamais modifier une migration déjà appliquée.

---

## Checklist

- [ ] Nommer le fichier avec timestamp actuel : `YYYYMMDDHHMMSS_description.sql`
- [ ] Placer dans `supabase/migrations/`
- [ ] Vérifier que la migration est idempotente si possible (`IF NOT EXISTS`, `CREATE OR REPLACE`)
- [ ] Appliquer avec `npx supabase db push`
- [ ] Mettre à jour `lib/db/types.ts` si de nouveaux types sont nécessaires
- [ ] Mettre à jour `docs/ARCHITECTURE.md` si le schéma change significativement

---

## Nommage du fichier

```
Format : YYYYMMDDHHMMSS_description_courte.sql
Exemple : 20260510143000_add_feedback_table.sql
```

La liste complète des migrations existantes est dans `docs/ARCHITECTURE.md`.

---

## Templates SQL

### Nouvelle table simple

```sql
-- YYYYMMDDHHMMSS_nom_table.sql

CREATE TABLE IF NOT EXISTS nom_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- colonnes métier
  content text NOT NULL,
  score float,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index fréquemment utiles
CREATE INDEX IF NOT EXISTS nom_table_user_id_idx ON nom_table(user_id);
CREATE INDEX IF NOT EXISTS nom_table_created_at_idx ON nom_table(created_at DESC);

-- RLS (obligatoire sur toutes les tables)
ALTER TABLE nom_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rows"
  ON nom_table FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rows"
  ON nom_table FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rows"
  ON nom_table FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rows"
  ON nom_table FOR DELETE
  USING (auth.uid() = user_id);
```

### Ajouter une colonne

```sql
-- YYYYMMDDHHMMSS_add_colonne_to_table.sql

ALTER TABLE nom_table
  ADD COLUMN IF NOT EXISTS nouvelle_colonne text,
  ADD COLUMN IF NOT EXISTS autre_colonne integer DEFAULT 0;

-- Si index nécessaire
CREATE INDEX IF NOT EXISTS nom_table_nouvelle_colonne_idx ON nom_table(nouvelle_colonne);
```

### Nouvelle fonction RPC (recherche vectorielle)

```sql
-- YYYYMMDDHHMMSS_add_rpc_nom.sql

CREATE OR REPLACE FUNCTION nom_fonction (
  query_embedding vector(384),
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.0
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

### Trigger FTS automatique

```sql
-- YYYYMMDDHHMMSS_add_fts_trigger.sql

-- Colonne tsvector
ALTER TABLE nom_table
  ADD COLUMN IF NOT EXISTS content_tsv tsvector;

-- Trigger pour mise à jour automatique
CREATE OR REPLACE FUNCTION update_content_tsv()
RETURNS trigger AS $$
BEGIN
  NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nom_table_content_tsv_trigger
  BEFORE INSERT OR UPDATE ON nom_table
  FOR EACH ROW EXECUTE FUNCTION update_content_tsv();

-- Index GIN pour les recherches FTS
CREATE INDEX IF NOT EXISTS nom_table_content_tsv_idx
  ON nom_table USING GIN(content_tsv);

-- Remplir les lignes existantes
UPDATE nom_table SET content_tsv = to_tsvector('english', COALESCE(content, ''));
```

---

## Appliquer la migration

```bash
# Lier le projet Supabase (une seule fois)
npx supabase link --project-ref VOTRE_REF

# Appliquer toutes les migrations en attente
npx supabase db push

# Vérifier l'état des migrations
npx supabase migration list
```

---

## Mettre à jour lib/db/types.ts

Après une migration qui ajoute une table ou des colonnes, mettre à jour les types TypeScript :

```typescript
// lib/db/types.ts — exemple pour une nouvelle table

export interface Feedback {
  id: string
  user_id: string
  message_id: string
  rating: 'positive' | 'negative'
  created_at: string
}

// Type pour l'insertion (sans id et created_at)
export type FeedbackInsert = Omit<Feedback, 'id' | 'created_at'>
```

---

## Règles importantes

- **Ne jamais modifier** une migration déjà appliquée en production — créer une nouvelle migration
- **RLS obligatoire** sur toutes les nouvelles tables
- **vector(384)** uniquement pour les embeddings — dimension fixe dans tout le projet
- Les colonnes `*_tsv` (tsvector) doivent toujours être gérées par un trigger, jamais manuellement
- Tester en local (`npm run dev`) avant `npx supabase db push` en production
