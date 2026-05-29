"""
enrich_journals.py — Enrichit journal + doi via OpenAlex (recherche par titre).

Usage:
    cd scripts && python3 enrich_journals.py

Pour chaque document avec journal NULL et un titre, interroge l'API OpenAlex
par titre, récupère le journal et le DOI si le titre correspond bien,
puis met à jour la table documents en base.

Safe à relancer : ne touche que les docs avec journal IS NULL.
"""

from __future__ import annotations

import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import json
from difflib import SequenceMatcher

# ── Config ───────────────────────────────────────────────────────────────────

BATCH_LOG   = 50     # Affiche la progression tous les N docs
SLEEP_S     = 0.25   # ~4 req/sec — OpenAlex polite pool
MIN_SCORE   = 0.82   # Seuil de similarité titre pour accepter le match
MAILTO      = "carel.clogenson@epitech.digital"  # Pour le polite pool OpenAlex

# ── Supabase ─────────────────────────────────────────────────────────────────

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    env = {}
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def get_supabase():
    from supabase import create_client
    env = load_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        sys.exit("❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local")
    return create_client(url, key)

# ── OpenAlex ─────────────────────────────────────────────────────────────────

def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()

def openalex_lookup(title: str) -> dict | None:
    """Cherche un titre dans OpenAlex, retourne { journal, doi } ou None."""
    encoded = urllib.parse.quote(title[:200])
    url = (
        f"https://api.openalex.org/works"
        f"?filter=title.search:{encoded}"
        f"&select=doi,title,primary_location"
        f"&per-page=1"
        f"&mailto={MAILTO}"
    )
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"Alexandria/1.0 (mailto:{MAILTO})"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            results = data.get("results", [])
            if not results:
                return None
            hit = results[0]
            hit_title = hit.get("title") or ""
            score = title_similarity(title, hit_title)
            if score < MIN_SCORE:
                return None
            doi = hit.get("doi") or None
            if doi and doi.startswith("https://doi.org/"):
                doi = doi[len("https://doi.org/"):]
            loc = hit.get("primary_location") or {}
            source = loc.get("source") or {}
            journal = source.get("display_name") or None
            if not journal:
                return None
            return {"journal": journal, "doi": doi, "score": round(score, 3)}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 10 * (attempt + 1)
                print(f"  [openalex] rate limit — attente {wait}s...", flush=True)
                time.sleep(wait)
            else:
                return None
        except Exception:
            return None
    return None

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=== enrich_journals.py — enrichissement via OpenAlex ===", flush=True)
    sb = get_supabase()

    # Récupère tous les docs avec journal NULL et un titre
    print("[1/3] Chargement des documents sans journal...", flush=True)
    rows = []
    page_size = 1000
    offset = 0
    while True:
        res = (
            sb.table("documents")
            .select("id, title, doi")
            .is_("journal", "null")
            .not_.is_("title", "null")
            .eq("status", "done")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    total = len(rows)
    print(f"  → {total} documents à enrichir", flush=True)
    if not total:
        print("  ✅ Rien à faire — tous les documents ont déjà un journal.", flush=True)
        return

    # Enrichissement
    print("[2/3] Recherche OpenAlex par titre...", flush=True)
    updated = 0
    not_found = 0

    for i, row in enumerate(rows):
        title = (row.get("title") or "").strip()
        if not title or len(title) < 10:
            not_found += 1
            continue

        result = openalex_lookup(title)
        time.sleep(SLEEP_S)

        if result:
            patch = {"journal": result["journal"]}
            if not row.get("doi") and result.get("doi"):
                patch["doi"] = result["doi"]
            sb.table("documents").update(patch).eq("id", row["id"]).execute()
            updated += 1
            if updated <= 5 or updated % BATCH_LOG == 0:
                print(f"  ✅ [{i+1}/{total}] {title[:60]} → {result['journal']} (score {result['score']})", flush=True)
        else:
            not_found += 1

        if (i + 1) % BATCH_LOG == 0:
            print(f"  ... {i+1}/{total} traités ({updated} enrichis)", flush=True)

    print(f"\n[3/3] Terminé.", flush=True)
    print(f"  Documents enrichis   : {updated}", flush=True)
    print(f"  Non trouvés          : {not_found}", flush=True)
    print(f"  Total traités        : {total}", flush=True)
    print("\nRelance 'npm run dev' puis recharge la page Database pour voir les journaux.", flush=True)

if __name__ == "__main__":
    main()
