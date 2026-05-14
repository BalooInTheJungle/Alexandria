#!/usr/bin/env python3
"""
Calcule les coordonnées UMAP 2D à partir des embeddings existants dans Supabase
et les écrit dans les colonnes chunks.umap_x / chunks.umap_y.

Usage:
    cd scripts && python3 compute_umap.py

Prérequis:
    pip install umap-learn (déjà dans requirements.txt)
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
from supabase import create_client

FETCH_BATCH  = 1000   # lignes par page Supabase
UPDATE_BATCH = 200    # updates par requête

def get_supabase():
    url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        sys.exit("❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local")
    return create_client(url, key)


def fetch_embeddings(sb):
    """Récupère tous les chunk ids + embeddings (pagination Supabase)."""
    ids, embeddings = [], []
    offset = 0
    print("📥  Récupération des embeddings depuis Supabase...")
    while True:
        res = (
            sb.table("chunks")
            .select("id, embedding")
            .not_.is_("embedding", "null")
            .range(offset, offset + FETCH_BATCH - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            ids.append(r["id"])
            emb = r["embedding"]
            if isinstance(emb, str):
                emb = json.loads(emb)
            embeddings.append(emb)
        offset += len(rows)
        print(f"   {offset} chunks chargés...", end="\r")
        if len(rows) < FETCH_BATCH:
            break
    print(f"\n✅  {len(ids)} embeddings chargés.")
    return ids, embeddings


def compute_umap(embeddings):
    """Projette les embeddings 384D en 2D avec UMAP."""
    print("🔄  Calcul UMAP (peut prendre 2-5 minutes pour 35k chunks)...")
    matrix = np.array(embeddings, dtype=np.float32)
    reducer = umap.UMAP(
        n_components=2,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
        verbose=True,
    )
    coords = reducer.fit_transform(matrix)
    print("✅  UMAP calculé.")
    return coords


def write_back(sb, ids, coords):
    """Écrit umap_x / umap_y dans Supabase par batch."""
    total = len(ids)
    batches = math.ceil(total / UPDATE_BATCH)
    print(f"💾  Écriture de {total} coordonnées en {batches} batches...")

    for b in range(batches):
        start = b * UPDATE_BATCH
        end   = min(start + UPDATE_BATCH, total)
        for i in range(start, end):
            sb.table("chunks").update({
                "umap_x": float(coords[i, 0]),
                "umap_y": float(coords[i, 1]),
            }).eq("id", ids[i]).execute()
        pct = round(end / total * 100)
        print(f"   batch {b + 1}/{batches} ({pct}%)", end="\r")

    print(f"\n✅  {total} chunks mis à jour.")


def main():
    sb = get_supabase()
    ids, embeddings = fetch_embeddings(sb)
    if not ids:
        sys.exit("❌  Aucun embedding trouvé en base.")
    coords = compute_umap(embeddings)
    write_back(sb, ids, coords)
    print("🎉  compute_umap.py terminé.")


if __name__ == "__main__":
    main()
