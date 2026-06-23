#!/usr/bin/env python3
"""
Calcule les coordonnées UMAP 2D à partir des embeddings existants dans Supabase
et les écrit dans les colonnes chunks.umap_x / chunks.umap_y.

Usage:
    cd scripts && python3 compute_umap.py           # 1 chunk/doc (~3700 points, rapide)
    cd scripts && python3 compute_umap.py --all     # tous les chunks (848k, très long)

Prérequis:
    pip install umap-learn psycopg2-binary
"""
import os
import sys
import math
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
env_path = project_root / ".env.local"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

import json
import numpy as np
import umap
import psycopg2
import psycopg2.extras

UPDATE_BATCH = 500
ALL_CHUNKS = "--all" in sys.argv


def get_conn():
    db_url = (os.environ.get("SUPABASE_DB_URL") or "").strip()
    if not db_url:
        sys.exit("❌  SUPABASE_DB_URL manquant dans .env.local")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = 0;")
    return conn


def fetch_embeddings(conn):
    """Récupère les embeddings — 1 chunk par doc (position=0) par défaut, ou tous avec --all."""
    if ALL_CHUNKS:
        print("📥  Récupération de TOUS les embeddings (mode --all)...")
        sql = """
            SELECT id, embedding FROM chunks
            WHERE embedding IS NOT NULL AND (is_temp = false OR is_temp IS NULL)
        """
    else:
        print("📥  Récupération d'1 chunk par document (position=0)...")
        sql = """
            SELECT id, embedding FROM chunks
            WHERE embedding IS NOT NULL AND position = 0 AND (is_temp = false OR is_temp IS NULL)
        """

    ids, embeddings = [], []
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
        for r in rows:
            ids.append(str(r["id"]))
            emb = r["embedding"]
            if isinstance(emb, str):
                emb = json.loads(emb)
            embeddings.append(emb)

    print(f"✅  {len(ids)} embeddings chargés.")
    return ids, embeddings


def compute_umap(embeddings):
    n = len(embeddings)
    print(f"🔄  Calcul UMAP sur {n} points...")
    matrix = np.array(embeddings, dtype=np.float32)
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        verbose=True,
    )
    coords = reducer.fit_transform(matrix)
    print("✅  UMAP calculé.")
    return coords


def write_back(conn, ids, coords):
    total = len(ids)
    batches = math.ceil(total / UPDATE_BATCH)
    print(f"💾  Écriture de {total} coordonnées en {batches} batches...")

    with conn.cursor() as cur:
        for b in range(batches):
            start = b * UPDATE_BATCH
            end = min(start + UPDATE_BATCH, total)
            data = [(float(coords[i, 0]), float(coords[i, 1]), ids[i]) for i in range(start, end)]
            psycopg2.extras.execute_batch(
                cur,
                "UPDATE chunks SET umap_x = %s, umap_y = %s WHERE id = %s::uuid",
                data,
                page_size=UPDATE_BATCH
            )
            pct = round(end / total * 100)
            print(f"   batch {b + 1}/{batches} ({pct}%)", end="\r")

    print(f"\n✅  {total} chunks mis à jour.")


def main():
    conn = get_conn()
    ids, embeddings = fetch_embeddings(conn)
    if not ids:
        sys.exit("❌  Aucun embedding trouvé en base.")
    coords = compute_umap(embeddings)
    write_back(conn, ids, coords)
    conn.close()
    print("🎉  compute_umap.py terminé.")


if __name__ == "__main__":
    main()
