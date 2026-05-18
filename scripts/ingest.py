#!/usr/bin/env python3
"""
Ingestion Alexandria : data/pdfs/**/*.pdf → documents + chunks (Supabase).
- Scan récursif des sous-dossiers (organisés par année).
- Parse PDF (PyMuPDF), fallback OCR si peu de texte (PDF scanné).
- Métadonnées : titre, auteurs, DOI, journal, published_at.
- Dédup par DOI en priorité, puis par storage_path.
- Chunking par section ou par taille.
- Embeddings 384D (sentence-transformers). Pas de traduction EN→FR.
"""
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
env_path = project_root / ".env.local"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

import psycopg2
import fitz  # PyMuPDF
from supabase import create_client

# Connexion directe pour opérations longues (index, vacuum)
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
# Format : postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres

PDF_DIR             = project_root / "data" / "pdfs"
EMBED_DIM           = 384
CHUNK_SIZE          = 600
CHUNK_OVERLAP       = 100
MIN_TEXT_PER_PAGE   = 50    # chars en dessous desquels on tente l'OCR
INSERT_BATCH        = 50    # chunks par requête Supabase (index HNSW droppé)
INSERT_PAUSE        = 0.1  # secondes entre chaque batch

# Journaux connus dans le domaine chimie/magnétisme moléculaire
_KNOWN_JOURNALS = [
    "Inorganic Chemistry", "Inorg. Chem.",
    "Journal of the American Chemical Society", "J. Am. Chem. Soc.",
    "Angewandte Chemie", "Angew. Chem.",
    "Chemical Communications", "Chem. Commun.",
    "Dalton Transactions", "Dalton Trans.",
    "CrystEngComm",
    "Chemistry – A European Journal", "Chem. Eur. J.",
    "European Journal of Inorganic Chemistry", "Eur. J. Inorg. Chem.",
    "Journal of Materials Chemistry", "J. Mater. Chem.",
    "New Journal of Chemistry", "New J. Chem.",
    "Chemical Science",
    "Nature Chemistry", "Nature Commun",
    "Physical Chemistry Chemical Physics", "Phys. Chem. Chem. Phys.",
    "Polyhedron",
    "Coordination Chemistry Reviews", "Coord. Chem. Rev.",
    "Journal of Coordination Chemistry", "J. Coord. Chem.",
    "Magnetochemistry",
    "Journal of Magnetism and Magnetic Materials",
    "Molecules",
    "RSC Advances",
    "Crystal Growth & Design", "Cryst. Growth Des.",
]


# ── Supabase ─────────────────────────────────────────────────────────────────

def get_supabase():
    url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        sys.exit("❌  NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant dans .env.local")
    return create_client(url, key)


# ── Texte & nettoyage ────────────────────────────────────────────────────────

def clean(text: str) -> str:
    return text.replace("\x00", " ").replace("", " ") if text else text


def extract_text_with_ocr_fallback(pdf_path: Path) -> tuple[str, dict[int, str], int]:
    doc = fitz.open(pdf_path)
    num_pages = len(doc)
    full_text, page_texts, ocr_count = [], {}, 0
    try:
        for i in range(num_pages):
            if (i + 1) % 50 == 0 or i + 1 == num_pages:
                print(f"  [extraction] page {i+1}/{num_pages}", flush=True)
            page = doc[i]
            text = page.get_text()
            if len(text.strip()) < MIN_TEXT_PER_PAGE:
                ocr_count += 1
                try:
                    import pdf2image, pytesseract
                    img = pdf2image.convert_from_path(str(pdf_path), first_page=i+1, last_page=i+1, dpi=150)
                    if img:
                        text = pytesseract.image_to_string(img[0], lang="eng")
                except Exception as e:
                    text = text + f"\n[OCR non disponible: {e}]"
            page_texts[i + 1] = text
            full_text.append(text)
    finally:
        doc.close()
    joined = clean("\n\n".join(full_text))
    return joined, {k: clean(v) for k, v in page_texts.items()}, ocr_count


# ── Métadonnées ───────────────────────────────────────────────────────────────

def _parse_authors(author_str: str) -> list[str]:
    if not author_str:
        return []
    parts = re.split(r"[;,]", author_str)
    return [p.strip() for p in parts if p.strip() and 1 < len(p.strip()) < 200][:50]


def _extract_authors_heuristic(full_text: str, title: object) -> list[str]:
    head = full_text[:4000]
    lines = [l.strip() for l in head.split("\n") if l.strip()]
    section_start = next(
        (i for i, l in enumerate(lines)
         if re.match(r"^(Abstract|Introduction|Keywords|1\.\s|I\.\s)", l, re.IGNORECASE)),
        len(lines)
    )
    title_lower = (title or "").lower()
    candidates = []
    for l in lines[:min(section_start, 15)]:
        if not l or len(l) > 150:
            continue
        if title_lower and l.lower() == title_lower:
            continue
        if re.match(r"^(DOI|https?://|©|Copyright|Published|Received|Accepted)\b", l, re.IGNORECASE):
            continue
        candidates.append(l)
    if not candidates:
        return []
    if len(candidates) == 1:
        return _parse_authors(candidates[0].replace(" and ", "; "))
    authors = []
    for c in candidates[:10]:
        for part in re.split(r",\s*and\s+|\s+and\s+|&", c):
            part = part.strip().rstrip(".,")
            if part and 2 <= len(part) <= 120:
                authors.append(part)
    return authors[:30]


def _extract_year_from_folder(pdf_path: Path) -> object:
    """Extrait l'année depuis le nom du dossier parent si c'est un millésime (ex: '1996')."""
    parent = pdf_path.parent.name
    m = re.fullmatch(r"(19\d{2}|20\d{2})", parent)
    return int(m.group(1)) if m else None


def _extract_year_from_text(text: str) -> object:
    """Cherche une année de publication dans les 3000 premiers caractères."""
    head = text[:3000]
    patterns = [
        r"(?:received|published|accepted|©)\s*(?:\w+\s+)?(\b(?:19|20)\d{2}\b)",
        r"\b((?:19|20)\d{2})\b",
    ]
    for pattern in patterns:
        m = re.search(pattern, head, re.IGNORECASE)
        if m:
            year = int(m.group(1))
            if 1900 <= year <= 2030:
                return year
    return None


def _extract_journal(text: str) -> object:
    """Cherche un nom de journal connu dans les 2000 premiers caractères."""
    head = text[:2000]
    for journal in _KNOWN_JOURNALS:
        if journal.lower() in head.lower():
            return journal
    # Heuristique générique : ligne courte qui contient des mots-clés de journal
    for line in head.split("\n"):
        line = line.strip()
        if 5 < len(line) < 80:
            if re.search(r"\b(Journal|Chemistry|Communications?|Letters|Transactions?|Reviews?|Science)\b", line, re.IGNORECASE):
                if not re.search(r"(https?://|DOI|@|©|\d{4}-\d{4})", line):
                    return line
    return None


def extract_metadata(doc: fitz.Document, full_text: str, pdf_path: Path) -> dict:
    meta = doc.metadata or {}
    title = (meta.get("title") or "").strip()
    authors = _parse_authors(meta.get("author") or meta.get("authors") or "")

    doi_m = re.search(r"10\.\d{4,}/[^\s]+", full_text[:10000])
    doi = doi_m.group(0).rstrip(".,;") if doi_m else None

    if not title:
        for block in full_text[:3000].split("\n\n"):
            b = block.strip()
            if len(b) > 10 and not b.lower().startswith(("abstract", "keywords")):
                title = b[:500]
                break

    if not authors:
        authors = _extract_authors_heuristic(full_text, title or None)

    journal = _extract_journal(full_text)

    year = _extract_year_from_folder(pdf_path) or _extract_year_from_text(full_text)
    published_at = f"{year}-01-01" if year else None

    return {
        "title":        clean(title).strip() or None,
        "authors":      authors or None,
        "doi":          clean(doi).strip() if doi else None,
        "journal":      clean(journal).strip() if journal else None,
        "published_at": published_at,
    }


# ── Chunking ─────────────────────────────────────────────────────────────────

_SECTION_RE = re.compile(
    r"^(?:\d+\.?\s*)?"
    r"(Abstract|Introduction|Methods?|Materials?\s+and\s+Methods?|Results?|Discussion"
    r"|Conclusions?|References|Acknowledgm?ents?|Experimental|Background|Summary)"
    r"(?:\s+and\s+Discussion)?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _chunk_page(text: str) -> list:
    out, current, current_len, section = [], [], 0, None
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped and _SECTION_RE.match(stripped):
            if current:
                block = "\n".join(current).strip()
                if block:
                    out.append((block, section))
            current, current_len, section = [line], len(line) + 1, stripped
            continue
        current.append(line)
        current_len += len(line) + 1
        if current_len >= CHUNK_SIZE:
            block = "\n".join(current).strip()
            if block:
                out.append((block, section))
            overlap, overlap_len = [], 0
            for ll in reversed(current):
                overlap.insert(0, ll)
                overlap_len += len(ll) + 1
                if overlap_len >= CHUNK_OVERLAP:
                    break
            current = overlap
            current_len = sum(len(ll) + 1 for ll in current)
    if current:
        block = "\n".join(current).strip()
        if block:
            out.append((block, section))
    return out


def chunk_text(text: str, page_texts: dict[int, str]) -> list:
    if not page_texts:
        return [(clean(c), 1, s) for c, s in _chunk_page(text)] or [(text[:8000].strip(), 1, None)]
    out, last_section = [], None
    for page_num in sorted(page_texts.keys()):
        content = page_texts[page_num]
        if not content.strip():
            continue
        for c, s in _chunk_page(content):
            title = s if s is not None else last_section
            if s is not None:
                last_section = s
            out.append((clean(c), page_num, title))
    return out or [(text[:8000].strip(), 1, None)]


# ── Dédup ─────────────────────────────────────────────────────────────────────

def already_indexed_by_doi(sb, doi: object) -> bool:
    if not doi:
        return False
    r = sb.table("documents").select("id").eq("doi", doi).eq("status", "done").execute()
    return bool(r.data)


def find_existing_by_path(sb, storage_path: str) -> object:
    r = sb.table("documents").select("id, status").eq("storage_path", storage_path).execute()
    return r.data[0] if r.data else None


# ── Index pgvector ────────────────────────────────────────────────────────────

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
    print("[index] Creating IVFFlat index on chunks.embedding (lists=100)...", flush=True)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_chunks_embedding
        ON chunks USING ivfflat (embedding vector_cosine_ops)
        WITH (lists=100)
    """)
    print("[index] Index created successfully.", flush=True)
    cur.close()
    conn.close()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    sb = get_supabase()

    if not PDF_DIR.exists():
        sys.exit(f"❌  Dossier {PDF_DIR} introuvable.")

    YEAR_MIN, YEAR_MAX = 2025, 2025
    pdf_files = sorted(
        p for p in PDF_DIR.rglob("*.pdf")
        if re.fullmatch(r"20\d{2}", p.parent.name)
        and YEAR_MIN <= int(p.parent.name) <= YEAR_MAX
    )
    if not pdf_files:
        sys.exit(f"❌  Aucun PDF dans {PDF_DIR} pour {YEAR_MIN}-{YEAR_MAX}")

    print(f"📂  {len(pdf_files)} PDF trouvés ({YEAR_MIN}–{YEAR_MAX}) dans {PDF_DIR}.")

    print("🤖  Chargement du modèle d'embeddings (all-MiniLM-L6-v2)...")
    from sentence_transformers import SentenceTransformer
    embed_model = SentenceTransformer("all-MiniLM-L6-v2")
    print("✅  Modèle prêt.\n")

    stats = {"done": 0, "skipped": 0, "error": 0}

    for idx, pdf_path in enumerate(pdf_files, 1):
        rel_path = str(pdf_path.relative_to(project_root))
        print(f"[{idx}/{len(pdf_files)}] {pdf_path.relative_to(PDF_DIR)}")

        try:
            # ── Extraction texte ──────────────────────────────────────────
            print("  [1/4] Extraction texte...", flush=True)
            full_text, page_texts, ocr_count = extract_text_with_ocr_fallback(pdf_path)
            print(f"  [1/4] {len(page_texts)} pages, {len(full_text)} chars, OCR: {ocr_count} pages.", flush=True)
            if not full_text.strip():
                raise ValueError("Aucun texte extrait (PDF vide ou illisible).")

            # ── Métadonnées + dédup ───────────────────────────────────────
            doc_fitz = fitz.open(pdf_path)
            try:
                meta = extract_metadata(doc_fitz, full_text, pdf_path)
            finally:
                doc_fitz.close()

            print(f"  [meta] titre: {repr((meta['title'] or '')[:80])}", flush=True)
            print(f"  [meta] journal: {repr(meta['journal'] or '(vide)')}", flush=True)
            print(f"  [meta] published_at: {meta['published_at'] or '(vide)'} | doi: {(meta['doi'] or '')[:40] or '(vide)'}", flush=True)

            # Dédup DOI
            if already_indexed_by_doi(sb, meta["doi"]):
                print(f"  ⏭   Déjà en base (DOI), skip.")
                stats["skipped"] += 1
                continue

            # Dédup storage_path
            existing = find_existing_by_path(sb, rel_path)
            if existing:
                if existing["status"] == "done":
                    print(f"  ⏭   Déjà indexé (path), skip.")
                    stats["skipped"] += 1
                    continue
                # error ou processing : on nettoie et on ré-ingère
                doc_id = existing["id"]
                sb.table("chunks").delete().eq("document_id", doc_id).execute()
                sb.table("documents").delete().eq("id", doc_id).execute()
                print(f"  🔄  Ré-ingestion (ancien status: {existing['status']}).")

            # ── Insert document ───────────────────────────────────────────
            doc_row = sb.table("documents").insert({
                "title":        meta["title"],
                "authors":      meta["authors"],
                "doi":          meta["doi"],
                "journal":      meta["journal"],
                "published_at": meta["published_at"],
                "storage_path": rel_path,
                "status":       "processing",
                "error_message": None,
            }).execute()
            document_id = doc_row.data[0]["id"]

            # ── Chunking ──────────────────────────────────────────────────
            print("  [2/4] Chunking...", flush=True)
            chunks_data = chunk_text(full_text, page_texts)
            print(f"  [2/4] {len(chunks_data)} chunks.", flush=True)

            # ── Embeddings ────────────────────────────────────────────────
            print("  [3/4] Embeddings...", flush=True)
            contents = [c[0] for c in chunks_data]
            embeddings = embed_model.encode(contents, show_progress_bar=False)
            print(f"  [3/4] {len(embeddings)} embeddings produits.", flush=True)

            # ── Insert chunks (batchs de INSERT_BATCH) ────────────────────
            print(f"  [4/4] Insert chunks (batches de {INSERT_BATCH})...", flush=True)
            batch = []
            for pos, ((content, page, section_title), emb) in enumerate(zip(chunks_data, embeddings)):
                batch.append({
                    "document_id":  document_id,
                    "content":      content,
                    "position":     pos,
                    "page":         page,
                    "section_title": clean(section_title) if section_title else None,
                    "embedding":    emb.tolist(),
                })
                if len(batch) >= INSERT_BATCH:
                    for attempt in range(3):
                        try:
                            sb.table("chunks").insert(batch).execute()
                            break
                        except Exception as e:
                            if attempt == 2:
                                raise
                            print(f"  [4/4] Retry {attempt+1}/3 après erreur: {str(e)[:60]}", flush=True)
                            time.sleep(2 ** attempt)
                    print(f"  [4/4] {min(pos+1, len(chunks_data))}/{len(chunks_data)} chunks insérés.", flush=True)
                    batch = []
                    time.sleep(INSERT_PAUSE)
            if batch:
                for attempt in range(3):
                    try:
                        sb.table("chunks").insert(batch).execute()
                        break
                    except Exception as e:
                        if attempt == 2:
                            raise
                        time.sleep(2 ** attempt)
            print(f"  [4/4] {len(chunks_data)}/{len(chunks_data)} chunks insérés.", flush=True)

            # ── Finalisation document ─────────────────────────────────────
            ingested_at = datetime.now(timezone.utc).isoformat()
            sb.table("documents").update({
                "status": "done",
                "error_message": None,
                "ingestion_log": {
                    "chunks_count":        len(chunks_data),
                    "ocr_pages_count":     ocr_count,
                    "title_extracted":     bool(meta["title"]),
                    "doi_extracted":       bool(meta["doi"]),
                    "journal_extracted":   bool(meta["journal"]),
                    "year_extracted":      bool(meta["published_at"]),
                    "ingested_at":         ingested_at,
                },
                "updated_at": ingested_at,
            }).eq("id", document_id).execute()

            print(f"  ✅  OK — {len(chunks_data)} chunks | journal: {meta['journal'] or '-'} | année: {meta['published_at'] or '-'}")
            stats["done"] += 1

        except Exception as e:
            err = str(e)[:1000]
            print(f"  ❌  Erreur: {err}")
            stats["error"] += 1
            time.sleep(1)  # pause avant de continuer
            try:
                ingested_at = datetime.now(timezone.utc).isoformat()
                r = sb.table("documents").select("id").eq("storage_path", rel_path).execute()
                if r.data:
                    sb.table("documents").update({
                        "status": "error",
                        "error_message": err,
                        "ingestion_log": {"error": err, "ingested_at": ingested_at},
                        "updated_at": ingested_at,
                    }).eq("id", r.data[0]["id"]).execute()
                else:
                    sb.table("documents").insert({
                        "storage_path": rel_path,
                        "status": "error",
                        "error_message": err,
                        "ingestion_log": {"error": err, "ingested_at": ingested_at},
                    }).execute()
            except Exception as e2:
                print(f"  ⚠️   Log erreur non enregistré: {str(e2)[:80]}", flush=True)

    # ── Index pgvector (après tous les inserts) ───────────────────────────────
    create_vector_index()

    # ── Récap final ───────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"🎉  Ingestion terminée : {stats['done']} OK | {stats['skipped']} skippés | {stats['error']} erreurs")
    try:
        r = sb.table("documents").select("id", count="exact").eq("status", "done").execute()
        n = r.count if hasattr(r, "count") and r.count else len(r.data or [])
        rc = sb.table("chunks").select("id", count="exact").execute()
        nc = rc.count if hasattr(rc, "count") and rc.count else len(rc.data or [])
        print(f"📊  Base : {n} documents done | {nc} chunks total")
    except Exception:
        pass


if __name__ == "__main__":
    main()
