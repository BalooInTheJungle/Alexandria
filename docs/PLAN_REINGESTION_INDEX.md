# PLAN — Réingestion complète + création index pendant l'ingestion

> Session suivante. Contexte : l'index pgvector ne peut pas être créé a posteriori
> (Supabase timeout). Solution : le créer directement dans `ingest.py` via psycopg2
> après tous les inserts, sans passer par l'API REST.

---

## Contexte

- **35 584 chunks** actuellement en base, **sans index** `idx_chunks_embedding`
- Supabase annule systématiquement la création d'index via SQL Editor ou psql (-c)
- La création d'index doit se faire dans une connexion longue, via `psycopg2` (Python direct)
- L'index invalide doit être droppé avant de commencer

---

## Étape 1 — Nettoyer la DB (SQL Editor Supabase)

```sql
-- Vérifier l'état avant
SELECT status, count(*) FROM documents GROUP BY status;
SELECT count(*) FROM chunks;

-- Dropper l'index invalide s'il existe
DROP INDEX IF EXISTS idx_chunks_embedding;

-- Vider les chunks et documents pour permettre la réingestion
TRUNCATE chunks;
DELETE FROM documents;

-- Vérifier
SELECT count(*) FROM chunks;   -- doit être 0
SELECT count(*) FROM documents; -- doit être 0
```

---

## Étape 2 — Modifier `scripts/ingest.py`

Ajouter à la fin du script (après tous les inserts) la création de l'index via `psycopg2`.

### 2a. Ajouter la dépendance en haut du fichier

```python
import psycopg2
```

### 2b. Ajouter la variable de connexion (en haut du script, avec les autres config)

```python
# Connexion directe pour opérations longues (index, vacuum)
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
# Format : postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres
```

### 2c. Ajouter la fonction de création d'index

```python
def create_vector_index():
    """Crée l'index IVFFlat sur chunks.embedding via connexion directe psycopg2."""
    if not SUPABASE_DB_URL:
        print("[index] SUPABASE_DB_URL not set — skipping index creation", flush=True)
        return
    print("[index] Connecting via psycopg2 for index creation...", flush=True)
    conn = psycopg2.connect(SUPABASE_DB_URL)
    conn.set_session(autocommit=True)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = '0';")
    print("[index] Creating IVFFlat index on chunks.embedding (lists=10)...", flush=True)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_chunks_embedding
        ON chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists=10)
    """)
    print("[index] Index created successfully.", flush=True)
    cur.close()
    conn.close()
```

### 2d. Appeler la fonction à la fin du `main()`

Juste avant le `print("=== Done ===")` final :
```python
    create_vector_index()
```

---

## Étape 3 — Ajouter la variable d'environnement

Dans `.env.local` (et variables Vercel si besoin) :

```
SUPABASE_DB_URL=postgresql://postgres:kodgos-9xajqe-Wodvac@db.whxnsqlrqjdrpjqlshvu.supabase.co:5432/postgres
```

Installer psycopg2 si pas déjà là :
```bash
pip3 install psycopg2-binary
```

---

## Étape 4 — Relancer l'ingestion

```bash
cd /Users/kclo/Documents/2026/Projet/Alexandria/scripts
python3 ingest.py
```

L'ingestion va :
1. Parser et chunker tous les PDFs de `data/pdfs/2015/` → `data/pdfs/2026/`
2. Insérer les chunks sans index (rapide)
3. Créer l'index IVFFlat à la fin via psycopg2 (connexion longue, sans timeout)

---

## Étape 5 — Vérifier

```sql
-- Index présent et valide
SELECT indexname, indisvalid
FROM pg_indexes
JOIN pg_class ON relname = indexname
JOIN pg_index ON indexrelid = pg_class.oid
WHERE tablename = 'chunks';

-- Taille DB après
SELECT pg_size_pretty(pg_total_relation_size('chunks')) AS chunks_size,
       pg_size_pretty(pg_database_size(current_database())) AS total_db_size;

-- Nombre de documents et chunks
SELECT status, count(*) FROM documents GROUP BY status;
SELECT count(*) FROM chunks;
```

---

## Étape 6 — Mettre à jour CLAUDE.md

Supprimer la section "DROP les index HNSW avant ingestion bulk" et la remplacer par :

> L'index pgvector est créé automatiquement par `ingest.py` à la fin de l'ingestion.
> Ne pas créer l'index manuellement depuis Supabase SQL Editor (timeout).

---

## Résumé

```
1. SQL : DROP INDEX invalide + TRUNCATE chunks + DELETE documents
2. ingest.py : ajouter create_vector_index() via psycopg2
3. .env.local : ajouter SUPABASE_DB_URL
4. pip3 install psycopg2-binary
5. python3 ingest.py (longue opération)
6. Vérifier index valide + taille DB
```
