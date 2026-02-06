#!/usr/bin/env python3
"""
Ingestion Alexandria : data/pdfs/ → documents + chunks (Supabase).
- Parse PDF (PyMuPDF), fallback OCR si peu de texte (PDF scanné).
- Métadonnées extraites du PDF.
- Chunking par section ou par taille.
- Embeddings sentence-transformers (384D).
"""
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Charger .env.local ou .env depuis la racine du projet
project_root = Path(__file__).resolve().parent.parent
env_path = project_root / ".env.local"
if not env_path.exists():
    env_path = project_root / ".env"
if env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(env_path)

import fitz  # PyMuPDF
from supabase import create_client

PDF_DIR = project_root / "data" / "pdfs"
EMBED_DIM = 384
CHUNK_SIZE = 600
CHUNK_OVERLAP = 100
MIN_TEXT_PER_PAGE = 50  # en dessous, on tente l'OCR pour cette page


def get_supabase():
    url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").strip()
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        raise SystemExit("Manque NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (.env.local)")
    if not url.startswith("https://") or ".supabase.co" not in url:
        raise SystemExit(
            "NEXT_PUBLIC_SUPABASE_URL doit être l’URL du projet (ex. https://xxxxx.supabase.co), "
            "pas l’URL du dashboard. Supabase → Settings → API → Project URL."
        )
    return create_client(url, key)


def clean_text_for_db(text: str) -> str:
    """Supprime les caractères que Postgres n’accepte pas en text (ex. \\u0000)."""
    if not text:
        return text
    return text.replace("\x00", " ").replace("\u0000", " ")


def extract_text_with_ocr_fallback(pdf_path: Path) -> tuple[str, dict[int, str], int]:
    """Extrait le texte page par page. Si une page a très peu de texte, OCR (pytesseract).
    Retourne (full_text, page_texts, ocr_pages_count).
    """
    doc = fitz.open(pdf_path)
    full_text = []
    page_texts = {}
    ocr_pages_count = 0
    try:
        for i in range(len(doc)):
            page = doc[i]
            text = page.get_text()
            page_texts[i + 1] = text
            if len(text.strip()) < MIN_TEXT_PER_PAGE:
                ocr_pages_count += 1
                try:
                    import pdf2image
                    import pytesseract
                    img = pdf2image.convert_from_path(str(pdf_path), first_page=i + 1, last_page=i + 1, dpi=150)
                    if img:
                        text = pytesseract.image_to_string(img[0], lang="eng")
                        page_texts[i + 1] = text
                except Exception as e:
                    page_texts[i + 1] = text + f"\n[OCR non disponible: {e}]"
            full_text.append(page_texts[i + 1])
    finally:
        doc.close()
    full_joined = clean_text_for_db("\n\n".join(full_text))
    page_texts_clean = {k: clean_text_for_db(v) for k, v in page_texts.items()}
    return full_joined, page_texts_clean, ocr_pages_count


def extract_metadata(doc: fitz.Document, full_text: str) -> dict:
    """Métadonnées depuis le PDF (XMP / première page)."""
    meta = doc.metadata or {}
    title = (meta.get("title") or "").strip()
    authors: list[str] = []
    doi = None
    journal = None
    published_at = None

    # DOI dans le texte (regex courante)
    doi_match = re.search(r"10\.\d{4,}/[^\s]+", full_text[:10000])
    if doi_match:
        doi = doi_match.group(0).rstrip(".,;")

    # Titre souvent sur la première page (première grosse ligne)
    first_page = full_text[:3000].split("\n\n")
    for line in first_page:
        line = line.strip()
        if len(line) > 10 and not title and not line.lower().startswith(("abstract", "keywords")):
            title = line[:500]
            break

    return {
        "title": (clean_text_for_db(title).strip() or None) if title else None,
        "authors": authors,
        "doi": clean_text_for_db(doi).strip() if doi else None,
        "journal": clean_text_for_db(journal).strip() if journal else None,
        "published_at": published_at,
    }


def chunk_text(text: str, _page_texts: dict[int, str]) -> list[tuple[str, int | None, str | None]]:
    """Découpe en chunks (sections si détectées, sinon taille fixe + overlap). (content, page, section_title)."""
    section_pattern = re.compile(
        r"^(Abstract|Introduction|Methods?|Results|Discussion|Conclusion|References|Acknowledgments?)\s*$",
        re.IGNORECASE | re.MULTILINE,
    )
    chunks_out = []
    current = []
    current_len = 0
    section_title = None

    lines = text.split("\n")
    for line in lines:
        if section_pattern.match(line.strip()):
            if current:
                block = "\n".join(current).strip()
                if block:
                    chunks_out.append((block, None, section_title))
            current = [line]
            current_len = len(line) + 1
            section_title = line.strip()
            continue
        current.append(line)
        current_len += len(line) + 1
        if current_len >= CHUNK_SIZE:
            block = "\n".join(current).strip()
            if block:
                chunks_out.append((block, None, section_title))
            overlap_lines = []
            overlap_len = 0
            for ll in reversed(current):
                overlap_lines.insert(0, ll)
                overlap_len += len(ll) + 1
                if overlap_len >= CHUNK_OVERLAP:
                    break
            current = overlap_lines
            current_len = sum(len(ll) + 1 for ll in current)

    if current:
        block = "\n".join(current).strip()
        if block:
            chunks_out.append((block, None, section_title))

    return chunks_out if chunks_out else [(text[:8000].strip(), None, None)]


def main():
    supabase = get_supabase()

    if not PDF_DIR.exists():
        print(f"Créer le dossier {PDF_DIR} et y déposer des PDF.")
        sys.exit(1)

    pdf_files = list(PDF_DIR.glob("*.pdf"))
    if not pdf_files:
        print(f"Aucun fichier .pdf dans {PDF_DIR}")
        sys.exit(0)

    print(f"Modèle d'embeddings (chargement unique)...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("all-MiniLM-L6-v2")

    for pdf_path in pdf_files:
        rel_path = f"data/pdfs/{pdf_path.name}"
        print(f"Traitement: {pdf_path.name}")

        # Déjà en base ?
        r = supabase.table("documents").select("id, status").eq("storage_path", rel_path).execute()
        if r.data and len(r.data) > 0:
            rec = r.data[0]
            if rec.get("status") == "done":
                print(f"  Déjà indexé (storage_path), skip.")
                continue
            # status error ou processing : on supprime et on ré-ingère
            doc_id = rec["id"]
            supabase.table("chunks").delete().eq("document_id", doc_id).execute()
            supabase.table("documents").delete().eq("id", doc_id).execute()
            print(f"  Ré-ingestion (ancien status: {rec.get('status')}).")

        try:
            full_text, page_texts, ocr_pages_count = extract_text_with_ocr_fallback(pdf_path)
            if not full_text.strip():
                raise ValueError("Aucun texte extrait (PDF vide ou OCR échoué).")

            doc_fitz = fitz.open(pdf_path)
            try:
                meta = extract_metadata(doc_fitz, full_text)
            finally:
                doc_fitz.close()

            # Insert document (processing)
            doc_row = supabase.table("documents").insert({
                "title": meta["title"],
                "authors": meta["authors"] or None,
                "doi": meta["doi"],
                "journal": meta["journal"],
                "published_at": meta["published_at"],
                "storage_path": rel_path,
                "status": "processing",
                "error_message": None,
            }).execute()
            document_id = doc_row.data[0]["id"]

            chunks_data = chunk_text(full_text, page_texts)
            embeddings = model.encode([c[0] for c in chunks_data], show_progress_bar=False)

            for pos, ((content, page, section_title), emb) in enumerate(zip(chunks_data, embeddings)):
                row = {
                    "document_id": document_id,
                    "content": clean_text_for_db(content),
                    "position": pos,
                    "section_title": clean_text_for_db(section_title) if section_title else None,
                    "embedding": emb.tolist(),
                }
                if page is not None:
                    row["page"] = page
                supabase.table("chunks").insert(row).execute()

            # Log d'ingestion (ce qu'on a récupéré ou non)
            ingested_at = datetime.now(timezone.utc).isoformat()
            ingestion_log = {
                "title_extracted": bool(meta.get("title")),
                "doi_extracted": bool(meta.get("doi")),
                "authors_extracted": bool(meta.get("authors")),
                "journal_extracted": bool(meta.get("journal")),
                "published_at_extracted": meta.get("published_at") is not None,
                "chunks_count": len(chunks_data),
                "ocr_pages_count": ocr_pages_count,
                "ingested_at": ingested_at,
            }

            supabase.table("documents").update({
                "status": "done",
                "error_message": None,
                "ingestion_log": ingestion_log,
                "updated_at": ingested_at,
            }).eq("id", document_id).execute()

            # Log console
            rec = "titre: oui" if meta.get("title") else "titre: non"
            rec += ", DOI: oui" if meta.get("doi") else ", DOI: non"
            rec += ", auteurs: oui" if meta.get("authors") else ", auteurs: non"
            rec += f", {len(chunks_data)} chunks"
            if ocr_pages_count:
                rec += f", {ocr_pages_count} page(s) OCR"
            print(f"  OK: {rec}.")

        except Exception as e:
            err_msg = str(e)
            print(f"  Erreur: {err_msg}")
            ingested_at = datetime.now(timezone.utc).isoformat()
            ingestion_log = {"error": err_msg, "ingested_at": ingested_at}
            r = supabase.table("documents").select("id").eq("storage_path", rel_path).execute()
            if r.data:
                supabase.table("documents").update({
                    "status": "error",
                    "error_message": err_msg,
                    "ingestion_log": ingestion_log,
                    "updated_at": ingested_at,
                }).eq("id", r.data[0]["id"]).execute()
            else:
                supabase.table("documents").insert({
                    "storage_path": rel_path,
                    "status": "error",
                    "error_message": err_msg,
                    "ingestion_log": ingestion_log,
                }).execute()

    print("Terminé.")


if __name__ == "__main__":
    main()
