#!/usr/bin/env python3
"""
fix_spaced_chunks.py — Corrige le texte espacé dans le contenu des chunks.

Les vieux PDFs (pré-2010) sont parfois encodés avec des espaces entre chaque
caractère : "K   a   s   u   y   a" ou "C   o   o   r   d   i   n   a   t   i   o   n".
Ce script détecte ces chunks, corrige le contenu et re-génère l'embedding.

Détection SQL (rapide, ne scanne pas 848k lignes en Python) :
  content ~ '([A-Za-z] {2,4}){10,}'   →  au moins 10 chars isolés consécutifs

Procédure :
  1. --dry-run   : compte les chunks affectés, affiche des exemples (sans modifier)
  2. --apply     : corrige le contenu + re-génère l'embedding + update DB

Usage :
    python3 fix_spaced_chunks.py --dry-run
    python3 fix_spaced_chunks.py --apply
    python3 fix_spaced_chunks.py --apply --limit 500     # batch partiel
    python3 fix_spaced_chunks.py --apply --author-only   # articles auteur seulement
"""

import argparse
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

# ── Config ────────────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent.parent / ".env.local")

DB_URL      = os.environ.get("SUPABASE_DB_URL")
MODEL_NAME  = "sentence-transformers/all-MiniLM-L6-v2"
EMBED_BATCH = 64    # chunks par batch d'embedding
UPDATE_BATCH = 50   # chunks par batch d'update DB

# Regex SQL : au moins 10 caractères isolés séparés par 2-4 espaces
SPACED_PATTERN = r"([A-Za-z] {2,4}){10,}"


# ── Helpers ───────────────────────────────────────────────────────────────────

def fix_spaced_text(s: str) -> str:
    """
    Corrige le texte espacé type ancien PDF OCR.

    Formats reconnus :
      "K   a   s   u   y   a"            → "Kasuya"           (chars + 3 espaces)
      "C o o r d i n a t i o n"          → "Coordination"     (chars + 1 espace)
      "S p i n   C r o s s o v e r"      → "Spin Crossover"   (mots séparés ≥5 espaces)

    Retourne la chaîne inchangée si elle ne correspond à aucun format connu.
    """
    stripped = s.strip()
    if not stripped:
        return stripped

    # Normalise les sauts de ligne entourés d'espaces → 7 espaces (séparateur de mots)
    normalized = re.sub(r"[ \t]*\n[ \t]*", "       ", stripped)

    # Essai 1 : plusieurs mots → séparation par ≥5 espaces
    word_groups = re.split(r" {5,}", normalized)
    if len(word_groups) > 1:
        result = " ".join("".join(g.split()) for g in word_groups if g.strip())
        if " " in result and len(result) > 5:
            return result

    # Essai 2 : un seul "mot" → tous les chars séparés par ≥2 espaces
    char_groups = [g for g in re.split(r" {2,}", stripped) if g.strip()]
    if char_groups and all(len(g) <= 2 for g in char_groups):
        single_word = "".join(char_groups)
        if len(single_word) > 1:
            return single_word

    return stripped


def is_spaced_text(text: str) -> bool:
    """
    Vérification rapide côté Python (double-check après le filtre SQL).
    Retourne True si >50% des mots sont des caractères isolés.
    """
    words = text.strip().split()
    if len(words) < 10:
        return False
    single = sum(1 for w in words if len(w) <= 1)
    return single / len(words) > 0.5


def looks_improved(original: str, fixed: str) -> bool:
    """Vérifie que le fix est réellement meilleur (pas de régression)."""
    if fixed == original:
        return False
    # Le texte fixé doit être plus court (on a enlevé des espaces inutiles)
    if len(fixed) >= len(original):
        return False
    # Le texte fixé ne doit pas être vide
    if len(fixed.strip()) < 5:
        return False
    return True


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Corrige le texte espacé dans les chunks")
    parser.add_argument("--dry-run",     action="store_true", help="Affiche les stats sans modifier")
    parser.add_argument("--apply",       action="store_true", help="Applique les corrections")
    parser.add_argument("--limit",       type=int, default=0, help="Nombre max de chunks à traiter (0 = tous)")
    parser.add_argument("--author-only", action="store_true", help="Traite uniquement les articles auteur")
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        parser.print_help()
        sys.exit(1)

    if not DB_URL:
        print("ERREUR : SUPABASE_DB_URL non défini dans .env.local")
        sys.exit(1)

    print(f"Connexion à la DB...")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # ── 1. Compter et récupérer les chunks affectés ─────────────────────────
    print(f"Recherche des chunks avec texte espacé (pattern SQL)...")

    author_filter = ""
    if args.author_only:
        author_filter = "AND d.is_author_article = true"

    limit_clause = f"LIMIT {args.limit}" if args.limit > 0 else ""

    cur.execute(f"""
        SELECT c.id, c.content, c.document_id, d.is_author_article
        FROM   public.chunks c
        JOIN   public.documents d ON d.id = c.document_id
        WHERE  c.content ~ %s
          AND  c.embedding IS NOT NULL
          {author_filter}
        {limit_clause};
    """, (SPACED_PATTERN,))

    rows = cur.fetchall()
    print(f"\n{'='*60}")
    print(f"Chunks avec texte espacé trouvés : {len(rows)}")
    if args.author_only:
        print(f"(filtre : articles auteur seulement)")

    if not rows:
        print("Rien à corriger.")
        conn.close()
        return

    # ── 2. Dry-run : affiche des exemples ───────────────────────────────────
    if args.dry_run:
        print(f"\nExemples (5 premiers) :\n")
        for row in rows[:5]:
            original = row["content"]
            fixed    = fix_spaced_text(original)
            improved = looks_improved(original, fixed)
            print(f"  Doc  : {row['document_id']} | auteur={row['is_author_article']}")
            print(f"  Avant: {original[:120]!r}")
            print(f"  Après: {fixed[:120]!r}")
            ok_str = "✓" if improved else "✗ (pas d'amélioration)"
            print(f"  OK   : {ok_str}")
            print()

        # Stats
        improvable = sum(1 for r in rows if looks_improved(r["content"], fix_spaced_text(r["content"])))
        print(f"Résumé :")
        print(f"  Chunks détectés       : {len(rows)}")
        print(f"  Corrigeables (fix OK) : {improvable}")
        print(f"  Non corrigeables      : {len(rows) - improvable}")
        conn.close()
        return

    # ── 3. Apply : corriger + re-embed + update DB ───────────────────────────
    print(f"\nChargement du modèle {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)
    print(f"Modèle chargé.")

    # Filtre les chunks réellement améliorables
    to_fix = [
        {"id": r["id"], "original": r["content"], "fixed": fix_spaced_text(r["content"])}
        for r in rows
        if looks_improved(r["content"], fix_spaced_text(r["content"]))
    ]

    not_improvable = len(rows) - len(to_fix)
    print(f"\nChunks à corriger  : {len(to_fix)}")
    print(f"Non corrigeables   : {not_improvable} (ignorés)")

    if not to_fix:
        print("Rien à corriger après vérification.")
        conn.close()
        return

    fixed_count  = 0
    errors_count = 0

    for i in range(0, len(to_fix), EMBED_BATCH):
        batch = to_fix[i : i + EMBED_BATCH]

        # Génère les nouveaux embeddings
        texts      = [item["fixed"] for item in batch]
        embeddings = model.encode(texts, normalize_embeddings=True).tolist()

        # Update DB par sous-batch
        for j in range(0, len(batch), UPDATE_BATCH):
            sub = batch[j : j + UPDATE_BATCH]
            sub_emb = embeddings[j : j + UPDATE_BATCH]
            try:
                for k, item in enumerate(sub):
                    cur.execute(
                        "UPDATE public.chunks SET content = %s, embedding = %s WHERE id = %s",
                        (item["fixed"], sub_emb[k], item["id"])
                    )
                conn.commit()
                fixed_count += len(sub)
            except Exception as e:
                conn.rollback()
                errors_count += len(sub)
                print(f"\nERREUR batch {i+j} : {e}")

        pct = round((fixed_count + errors_count) / len(to_fix) * 100, 1)
        print(f"  Progression : {fixed_count}/{len(to_fix)} ({pct}%) — erreurs: {errors_count}", end="\r")
        time.sleep(0.05)  # respire entre les batchs

    print(f"\n\n{'='*60}")
    print(f"Terminé !")
    print(f"  Corrigés avec succès : {fixed_count}")
    print(f"  Erreurs              : {errors_count}")
    print(f"  Non améliorables     : {not_improvable}")
    print()
    print("Note : le trigger content_tsv a été mis à jour automatiquement.")
    print("L'index IVFFlat ne nécessite PAS de rebuild (les embeddings changent")
    print("légèrement mais la structure de l'index reste valide).")

    conn.close()


if __name__ == "__main__":
    main()
