#!/usr/bin/env python3
"""
Fix titles of author articles in DB.

Three types of bad titles are handled:
  1. Garbage    — 'No Job Name', '*.dvi', 'CC XX...', pure binary → re-extract from chunks
  2. Binary     — spaced text with embedded control chars → clean + fix spacing
  3. Spaced     — 'M a g n e t i c ...' → fix_spaced_text + truncate before author block

Run:
    python3 fix_author_titles.py            # preview only
    python3 fix_author_titles.py --apply    # apply changes to DB
"""
import os
import re
import sys
from pathlib import Path
from typing import Optional

project_root = Path(__file__).resolve().parent.parent
env_path = project_root / ".env.local"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

from supabase import create_client


# ── Supabase ──────────────────────────────────────────────────────────────────

def get_supabase():
    url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        sys.exit("❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant")
    return create_client(url, key)


# ── Détection des catégories ──────────────────────────────────────────────────

GARBAGE_PATTERNS = [
    r"^No Job Name$",
    r"^b\d+\.dvi$",
    r"^CC \d+",
    r"^\s*$",
]

def is_garbage(title: str) -> bool:
    """Title is a known placeholder or empty."""
    if not title:
        return True
    for pat in GARBAGE_PATTERNS:
        if re.search(pat, title.strip(), re.IGNORECASE):
            return True
    return False


def has_binary(title: str) -> bool:
    """Title contains control characters (excluding tab/newline)."""
    return bool(re.search(r"[\x00-\x08\x0e-\x1f\x7f]", title))


def is_spaced(title: str) -> bool:
    """Title looks like 'M a g n e t i c ...' (single chars separated by spaces)."""
    if not title:
        return False
    tokens = [t for t in title.split(" ") if t]
    if len(tokens) < 6:
        return False
    return sum(1 for t in tokens if len(t) == 1) / len(tokens) >= 0.45


# ── Nettoyage ─────────────────────────────────────────────────────────────────

def clean_binary(s: str) -> str:
    """Remove control characters, keep printable + common unicode."""
    return re.sub(r"[\x00-\x08\x0e-\x1f\x7f]", "", s).strip()


def fix_spaced_text(s: str) -> str:
    """
    Reconstruit le texte des vieux PDFs où chaque caractère est isolé.

    Formats observés dans le corpus auteur :
      - Entre deux chars d'un même mot   : 3 espaces   'M   a   g   n   e   t   i   c'
      - Entre deux mots sur la même ligne : 7 espaces  'M   a   g   n   e   t   i   c       P   r   o   p'
      - Entre mots sur lignes différentes : \\n entouré de 3 espaces de chaque côté
      - Cas 1 espace (métadonnées PDF)    : 'M a g n e t i c P r o p e r t i e s'

    Stratégie :
      1. Normalise les \\n entourés d'espaces en 7 espaces (frontière de mot).
      2. Si 5+ espaces présents → coupe sur ces frontières, joint les chars de chaque groupe.
      3. Si seulement 3 espaces (une ligne = un seul mot) → joint tous les chars.
      4. Si 1 espace (métadonnées) → impossible à segmenter → retourne l'entrée inchangée.
    """
    if not s:
        return s
    stripped = s.strip()
    tokens = [t for t in re.split(r"\s+", stripped) if t]
    if len(tokens) < 6:
        return stripped
    single_ratio = sum(1 for t in tokens if len(t) == 1) / len(tokens)
    if single_ratio < 0.45:
        return stripped

    # Étape 1 : remplace \n entouré d'espaces par 7 espaces (frontière de mot)
    normalized = re.sub(r"[ \t]*\n[ \t]*", "       ", stripped)

    # Étape 2 : frontières de mots = 5+ espaces
    word_groups = re.split(r" {5,}", normalized)
    if len(word_groups) > 1:
        result = " ".join("".join(g.split()) for g in word_groups if g.strip())
        if " " in result and len(result) > 5:
            return result

    # Étape 3 : une seule ligne = un seul mot (3 espaces entre chars, pas de frontière)
    # On vérifie que les "groupes" après split sur 3+ espaces sont tous des chars uniques
    char_groups = [g for g in re.split(r" {2,}", stripped) if g.strip()]
    if char_groups and all(len(g) <= 1 for g in char_groups):
        single_word = "".join(char_groups)
        if len(single_word) > 1:
            return single_word   # ex: "Articles" ou "Dinuclear"

    # Métadonnées 1-espace : impossible à segmenter proprement — retourne tel quel
    return stripped


# Author-block markers: superscript markers, affiliation keywords, name patterns
_AUTHOR_MARKERS = re.compile(
    r"[,\s][A-Z][a-z]+ [A-Z][a-z]+(,|\*|\†|\‡|\[|\s*\d)"  # "Firstname Lastname,"
    r"|[,\s]\*[a-z]?"                                        # "*a", "*, "
    r"|\b(Received|Accepted|Published|Copyright|DOI|Abstract|Keywords)\b"
    r"|\b[A-Z][a-z]+ (University|Institut|Laborat|Department|CNRS|UMR)\b",
    re.UNICODE,
)


def truncate_at_authors(title: str, max_len: int = 300) -> str:
    """Truncate a (fixed) title when it drifts into author/affiliation text."""
    if len(title) <= max_len:
        return title
    # Try to cut at the first author-block marker after 40 chars
    m = _AUTHOR_MARKERS.search(title, 40)
    if m:
        cut = title[:m.start()].rstrip(" ,;*†‡")
        if len(cut) >= 20:
            return cut
    # Fallback: cut at last sentence boundary before max_len
    chunk = title[:max_len]
    for delim in (".", "?", "!"):
        idx = chunk.rfind(delim)
        if idx > 30:
            return chunk[:idx + 1].strip()
    return chunk.rstrip(" ,;").strip()


# ── Ré-extraction depuis les chunks ──────────────────────────────────────────

def _is_plausible_title(candidate: str) -> bool:
    """Check that a candidate string looks like a real scientific title."""
    c = candidate.strip()
    if not c or len(c) < 10 or len(c) > 500:
        return False
    # Reject if >30% control/binary chars
    ctrl = sum(1 for ch in c if ord(ch) < 32 and ch not in "\t\n")
    if ctrl / len(c) > 0.1:
        return False
    # Reject pure-number / very short words
    words = c.split()
    if len(words) < 2:
        return False
    # Reject obvious garbage
    if re.match(r"^(No Job Name|b\d+\.dvi|CC \d+)", c, re.IGNORECASE):
        return False
    return True


# Patterns d'affiliations/metadata à rejeter lors de l'extraction de titre
_AFFILIATION_RE = re.compile(
    r"\b(Laboratoire|Department|Institut|University|CNRS|UMR|URA|Received|Accepted"
    r"|Copyright|©|\bDOI\b|https?://|@|e-mail|E-mail)\b",
    re.IGNORECASE | re.UNICODE,
)


def _looks_readable(s: str) -> bool:
    """True if the string has spaces between words (not a concatenated blob)."""
    if not s or len(s) < 5:
        return False
    # Must have at least one space per 15 chars on average
    return s.count(" ") >= max(1, len(s) // 15)


def extract_title_from_chunk(content: str) -> Optional[str]:
    """
    Heuristic title extraction from the first chunk of an article.

    Strategy:
    - If the chunk is in old-style spaced format, reconstruct the full text
      first (using fix_spaced_text on the whole block), then scan for the title.
    - Otherwise, scan line by line.
    Returns the best candidate or None.
    """
    if not content:
        return None

    head = clean_binary(content[:4000])

    # Detect if the whole block is spaced text
    sample_tokens = [t for t in re.split(r"\s+", head[:500]) if t]
    block_is_spaced = (
        len(sample_tokens) >= 6
        and sum(1 for t in sample_tokens if len(t) == 1) / len(sample_tokens) >= 0.45
    )

    if block_is_spaced:
        # Décoder ligne par ligne pour conserver la structure (une ligne = 1-N mots)
        raw_lines = head.split("\n")
        decoded_lines = []
        for raw_line in raw_lines:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            if is_spaced(raw_line):
                decoded = fix_spaced_text(raw_line)
                # Garde seulement si on obtient quelque chose de lisible
                if _looks_readable(decoded) or (len(decoded) <= 20 and decoded.isalpha()):
                    decoded_lines.append(decoded)
            else:
                decoded_lines.append(raw_line)
        if not decoded_lines:
            return None
        work_text = "\n".join(decoded_lines)
    else:
        work_text = head

    # Split into lines and look for a title-like line
    lines = [l.strip() for l in work_text.split("\n") if l.strip()]

    # Stop at Abstract / Introduction / Keywords / Received
    stop_re = re.compile(
        r"^(Abstract|Introduction|Keywords|1\.\s|I\.\s|Received|Accepted|Published)",
        re.IGNORECASE,
    )
    stop_idx = next((i for i, l in enumerate(lines) if stop_re.match(l)), len(lines))

    candidates = []
    for line in lines[:min(stop_idx, 20)]:
        # Skip obvious meta lines
        if re.match(r"^(DOI|https?://|©|Copyright|Published|Received|Accepted|This article)", line, re.IGNORECASE):
            continue
        if re.match(r"^[\d\s\-\.\(\)]+$", line):   # page numbers, section markers
            continue
        if len(line) < 10:
            continue

        # For non-block-spaced mode: clean binary and attempt per-line fix
        if not block_is_spaced:
            line = clean_binary(line)
            if is_spaced(line):
                line = fix_spaced_text(line)
            if not _looks_readable(line):
                continue

        # Titles start with a capital letter or a digit (chemical formula)
        if line and line[0].islower():
            continue

        # Reject affiliations / author-list lines
        if _AFFILIATION_RE.search(line):
            continue
        # Reject author-list lines: "Name, superscript" pattern (Cotton,*[a] or Bera,a)
        if re.search(r"[A-Z][a-z]+,\s*[a-z*†‡\[\d]", line):
            continue
        if re.search(r"\b[A-Z][a-z]+ [A-Z][a-z]+,?\s*(\*|†|‡|\d|\[)", line):
            continue
        # Reject copyright / watermark / permission lines
        if re.search(
            r"\b(American Chemical Society|Wiley|Elsevier|Royal Society"
            r"|non-commercial|reproduction|distribution|licensing copies"
            r"|prohibited|institutional|personal website|third party"
            r"|ACS Publications|for instruction|authors institution"
            r"|posted to|posting to)\b",
            line, re.IGNORECASE
        ):
            continue
        # Reject journal header lines: "VOLUME 86, NUMBER 19 PHYSICAL REVIEW..."
        if re.match(r"^(VOLUME|NUMBER|COMMUNICATIONS|LETTER|ARTICLE)\b", line):
            continue

        if len(line) > 500:
            continue

        if _is_plausible_title(line):
            candidates.append(line)

    if not candidates:
        return None

    # Prefer title-length lines (30–250 chars)
    preferred = [c for c in candidates if 30 <= len(c) <= 250]
    pool = preferred if preferred else candidates
    return max(pool, key=len)[:400]


# ── Pipeline principal ────────────────────────────────────────────────────────

def process_document(doc: dict, first_chunk: Optional[str]) -> Optional[dict]:
    """
    Analyse the title and return a fix dict, or None if no change needed.
    Returns: { "id", "category", "old_title", "new_title" }
    """
    doc_id = doc["id"]
    title  = doc.get("title") or ""

    # ── Catégorie 1 : garbage ─────────────────────────────────────────────
    if is_garbage(title):
        new_title = extract_title_from_chunk(first_chunk) if first_chunk else None
        return {
            "id":        doc_id,
            "category":  "garbage",
            "old_title": title[:80] if title else "(null)",
            "new_title": new_title,
        }

    # ── Catégorie 2 : binaire ─────────────────────────────────────────────
    if has_binary(title):
        cleaned = clean_binary(title)
        if is_spaced(cleaned):
            fixed = fix_spaced_text(cleaned)
            fixed = truncate_at_authors(fixed)
        else:
            fixed = truncate_at_authors(cleaned)

        # If result has no spaces and is long → fix_spaced_text failed, try chunk
        if not _is_plausible_title(fixed) or (" " not in fixed and len(fixed) > 25):
            fixed = extract_title_from_chunk(first_chunk) if first_chunk else None

        if not fixed or fixed == title:
            return None
        return {
            "id":        doc_id,
            "category":  "binary",
            "old_title": title[:80],
            "new_title": fixed,
        }

    # ── Catégorie 3 : espacé ──────────────────────────────────────────────
    if is_spaced(title):
        fixed = fix_spaced_text(title)

        # Si fix_spaced_text n'a rien changé (1-espace, non segmentable) → essai chunk
        if fixed.strip() == title.strip():
            fixed = extract_title_from_chunk(first_chunk) if first_chunk else None
        else:
            fixed = truncate_at_authors(fixed)
            # Blob sans espaces → fallback chunk
            if fixed and " " not in fixed and len(fixed) > 25:
                fixed = extract_title_from_chunk(first_chunk) if first_chunk else None

        if not fixed or not _is_plausible_title(fixed):
            return None   # non récupérable
        if fixed.strip() == title.strip():
            return None   # aucun changement réel
        return {
            "id":        doc_id,
            "category":  "spaced",
            "old_title": title[:80],
            "new_title": fixed,
        }

    return None  # title OK


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Appliquer les corrections en base")
    args = parser.parse_args()

    sb = get_supabase()

    # ── Charger les articles auteur ───────────────────────────────────────────
    print("📥  Chargement des articles auteur...")
    page_size = 500
    offset    = 0
    all_docs  = []
    while True:
        r = sb.table("documents") \
              .select("id, title, published_at") \
              .eq("is_author_article", True) \
              .range(offset, offset + page_size - 1) \
              .execute()
        if not r.data:
            break
        all_docs.extend(r.data)
        if len(r.data) < page_size:
            break
        offset += page_size
    print(f"📊  {len(all_docs)} articles auteur chargés.\n")

    # ── Charger le premier chunk de chaque document ───────────────────────────
    print("📥  Chargement des premiers chunks...")
    doc_ids    = [d["id"] for d in all_docs]
    first_chunks: dict[str, str] = {}

    # Batch par 100 (limite Supabase)
    for i in range(0, len(doc_ids), 100):
        batch_ids = doc_ids[i:i + 100]
        r = sb.table("chunks") \
              .select("document_id, content") \
              .in_("document_id", batch_ids) \
              .eq("position", 0) \
              .execute()
        for row in r.data or []:
            first_chunks[row["document_id"]] = row["content"]
    print(f"📊  {len(first_chunks)} premiers chunks chargés.\n")

    # ── Analyse ───────────────────────────────────────────────────────────────
    fixes = []
    categories = {"garbage": 0, "binary": 0, "spaced": 0}

    for doc in all_docs:
        chunk_content = first_chunks.get(doc["id"])
        result = process_document(doc, chunk_content)
        if result:
            fixes.append(result)
            categories[result["category"]] += 1

    # ── Rapport ───────────────────────────────────────────────────────────────
    total = len(fixes)
    null_after = sum(1 for f in fixes if not f["new_title"])

    print(f"{'='*60}")
    print(f"📋  {total} titres à corriger :")
    print(f"     • Garbage (No Job Name, .dvi…) : {categories['garbage']}")
    print(f"     • Binaire (caractères de contrôle) : {categories['binary']}")
    print(f"     • Espacé (M a g n e t i c…) : {categories['spaced']}")
    print(f"     • Resteront NULL après correction : {null_after}")
    print(f"{'='*60}\n")

    # ── Prévisualisation par catégorie ────────────────────────────────────────
    for cat in ("garbage", "binary", "spaced"):
        cat_fixes = [f for f in fixes if f["category"] == cat]
        if not cat_fixes:
            continue
        print(f"── {cat.upper()} ({len(cat_fixes)}) ──")
        for f in cat_fixes[:4]:
            print(f"  AVANT : {f['old_title'][:70]}")
            print(f"  APRÈS : {(f['new_title'] or '(NULL)')[:70]}")
            print()
        if len(cat_fixes) > 4:
            print(f"  … et {len(cat_fixes) - 4} autres.\n")

    # ── Application ───────────────────────────────────────────────────────────
    if not args.apply:
        print("⚠️   Mode prévisualisation — relancer avec --apply pour appliquer.")
        return

    print("💾  Application des corrections...")
    updated = 0
    for f in fixes:
        sb.table("documents") \
          .update({"title": f["new_title"]}) \
          .eq("id", f["id"]) \
          .execute()
        updated += 1
        if updated % 20 == 0:
            print(f"  {updated}/{total} mis à jour…", flush=True)

    print(f"\n✅  {updated} titres corrigés en base.")
    print(f"   ({null_after} mis à NULL faute de contenu récupérable)")


if __name__ == "__main__":
    main()
