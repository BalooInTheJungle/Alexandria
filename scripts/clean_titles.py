#!/usr/bin/env python3
"""
Clean spaced titles in DB: 'T h e   R o l e' → 'The Role'.
Reads all documents, fixes spaced titles, updates DB.
"""
import os
import re
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
env_path = project_root / ".env.local"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

from supabase import create_client


def get_supabase():
    url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        sys.exit("❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant")
    return create_client(url, key)


def fix_spaced_text(s: str) -> str:
    if not s:
        return s
    s = s.strip()
    tokens = [t for t in s.split(' ') if t]
    if len(tokens) < 6:
        return s
    if sum(1 for t in tokens if len(t) == 1) / len(tokens) < 0.55:
        return s
    words = re.split(r' {2,}', s)
    return ' '.join(''.join(w.split()) for w in words if w.strip())


def main():
    sb = get_supabase()

    # Fetch all documents with titles
    print("📥  Chargement des documents...")
    page_size = 1000
    offset = 0
    all_docs = []
    while True:
        r = sb.table("documents").select("id, title").range(offset, offset + page_size - 1).execute()
        if not r.data:
            break
        all_docs.extend(r.data)
        if len(r.data) < page_size:
            break
        offset += page_size

    print(f"📊  {len(all_docs)} documents chargés.")

    # Find docs with spaced titles
    to_fix = []
    for doc in all_docs:
        title = doc.get("title") or ""
        fixed = fix_spaced_text(title)
        if fixed != title and fixed:
            to_fix.append({"id": doc["id"], "old": title[:60], "new": fixed[:60], "new_full": fixed})

    print(f"🔧  {len(to_fix)} titres à corriger.")

    if not to_fix:
        print("✅  Rien à corriger.")
        return

    # Preview first 5
    print("\nExemples :")
    for d in to_fix[:5]:
        print(f"  AVANT: {d['old']}")
        print(f"  APRÈS: {d['new']}")
        print()

    # Update in batches of 50
    updated = 0
    for i in range(0, len(to_fix), 50):
        batch = to_fix[i:i + 50]
        for doc in batch:
            sb.table("documents").update({"title": doc["new_full"]}).eq("id", doc["id"]).execute()
        updated += len(batch)
        print(f"  {updated}/{len(to_fix)} mis à jour...", flush=True)

    print(f"\n✅  {updated} titres corrigés en base.")


if __name__ == "__main__":
    main()
