#!/usr/bin/env python3
"""
Reorganize PDFs by publication year into data/pdfs2/YEAR/.
- Extracts year from filename (format: "YYYY, Author, Journal...")
- Only copies PDFs with publication year >= 2015
- Source: data/pdfs/ (all subfolders)
- Destination: data/pdfs2/YEAR/
"""
import re
import shutil
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR      = PROJECT_ROOT / "data" / "pdfs"
DST_DIR      = PROJECT_ROOT / "data" / "pdfs2"
YEAR_MIN     = 2015
YEAR_MAX     = 2026

YEAR_RE = re.compile(r'^(\d{4})[,\s]')


def extract_year(filename: str) -> Optional[int]:
    m = YEAR_RE.match(filename)
    if not m:
        return None
    year = int(m.group(1))
    if YEAR_MIN <= year <= YEAR_MAX:
        return year
    return None


def main():
    if not SRC_DIR.exists():
        print(f"❌  Dossier source introuvable : {SRC_DIR}")
        return

    DST_DIR.mkdir(parents=True, exist_ok=True)

    stats = {"copied": 0, "skipped_year": 0, "skipped_no_year": 0, "conflict": 0}

    pdf_files = list(SRC_DIR.rglob("*.pdf"))
    total = len(pdf_files)
    print(f"📂  {total} PDFs trouvés dans {SRC_DIR}")

    for i, src in enumerate(pdf_files, 1):
        if i % 500 == 0 or i == total:
            print(f"  [{i}/{total}] copied={stats['copied']} skipped={stats['skipped_year']} no_year={stats['skipped_no_year']} conflict={stats['conflict']}")

        year = extract_year(src.name)

        if year is None:
            stats["skipped_no_year"] += 1
            continue

        year_dir = DST_DIR / str(year)
        year_dir.mkdir(exist_ok=True)
        dst = year_dir / src.name

        if dst.exists():
            # Conflict: same filename in same year folder — keep both with suffix
            stem = src.stem
            suffix = src.suffix
            dst = year_dir / f"{stem}__dup{stats['conflict']}{suffix}"
            stats["conflict"] += 1

        shutil.copy2(src, dst)
        stats["copied"] += 1

    print(f"\n{'='*60}")
    print(f"✅  Terminé : {stats['copied']} copiés | {stats['skipped_year']} hors plage {YEAR_MIN}-{YEAR_MAX} | {stats['skipped_no_year']} sans année | {stats['conflict']} conflits")

    # Résumé par année
    print(f"\n📊  Répartition dans pdfs2/ :")
    for year_dir in sorted(DST_DIR.iterdir()):
        if year_dir.is_dir():
            count = len(list(year_dir.glob("*.pdf")))
            print(f"  {year_dir.name}: {count} PDFs")


if __name__ == "__main__":
    main()
