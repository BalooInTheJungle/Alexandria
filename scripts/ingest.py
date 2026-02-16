#!/usr/bin/env python3
"""
Ingestion Alexandria : data/pdfs/ → documents + chunks (Supabase).
- Parse PDF (PyMuPDF), fallback OCR si peu de texte (PDF scanné).
- Métadonnées extraites du PDF.
- Chunking par section ou par taille.
- Embeddings sentence-transformers (384D) pour content et content_fr.
- Traduction EN→FR (Helsinki-NLP/opus-mt-en-fr) pour content_fr.
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
TRANSLATE_BATCH_SIZE = 24  # plus gros batch sur M2 (32GB); moins d’appels model.generate
MAX_INPUT_LENGTH_TRANSLATE = 512  # tokens environ, tronquer pour le traducteur
TRANSLATE_NUM_BEAMS = 1  # 1 = greedy (rapide); 5 = beam (lent, meilleure qualité)


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


def _get_translation_device():
    """MPS (Apple Silicon) > CUDA > CPU pour accélérer la traduction."""
    try:
        import torch
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
    except Exception:
        pass
    return torch.device("cpu")


def translate_en_to_fr_batch(texts: list[str], model, tokenizer, device) -> list[str]:
    """Traduit une liste de textes EN→FR par batch (MarianMT). Les tensors sont sur device (MPS/CUDA/CPU)."""
    if not texts:
        return []
    out = []
    total_batches = (len(texts) + TRANSLATE_BATCH_SIZE - 1) // TRANSLATE_BATCH_SIZE
    for idx in range(0, len(texts), TRANSLATE_BATCH_SIZE):
        batch_num = idx // TRANSLATE_BATCH_SIZE + 1
        if batch_num == 1 or batch_num % 5 == 0 or batch_num == total_batches:
            print(f"  [traduction] batch {batch_num}/{total_batches} ({min(idx + TRANSLATE_BATCH_SIZE, len(texts))}/{len(texts)} textes)", flush=True)
        batch = texts[idx : idx + TRANSLATE_BATCH_SIZE]
        truncated = [t[: MAX_INPUT_LENGTH_TRANSLATE * 4] for t in batch]
        inputs = tokenizer(truncated, return_tensors="pt", padding=True, truncation=True, max_length=512)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        gen = model.generate(**inputs, max_length=512, num_beams=TRANSLATE_NUM_BEAMS)
        for ids in gen:
            out.append(tokenizer.decode(ids, skip_special_tokens=True))
    return out


def extract_text_with_ocr_fallback(pdf_path: Path) -> tuple[str, dict[int, str], int]:
    """Extrait le texte page par page. Si une page a très peu de texte, OCR (pytesseract).
    Retourne (full_text, page_texts, ocr_pages_count).
    """
    doc = fitz.open(pdf_path)
    num_pages = len(doc)
    full_text = []
    page_texts = {}
    ocr_pages_count = 0
    try:
        for i in range(num_pages):
            if (i + 1) % 50 == 0 or i + 1 == num_pages:
                print(f"  [extraction] page {i + 1}/{num_pages}", flush=True)
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


def _parse_authors_from_metadata(author_str: str) -> list[str]:
    """Parse XMP/PDF metadata author string (semicolon or comma separated)."""
    if not author_str or not author_str.strip():
        return []
    # Split by ; or , and clean
    parts = re.split(r"[;,]", author_str)
    out = []
    for p in parts:
        name = p.strip()
        if name and len(name) > 1 and len(name) < 200:
            out.append(name)
    return out[:50]  # cap

def _extract_authors_from_first_page(full_text: str, title: str | None) -> list[str]:
    """Heuristic: lines between title and Abstract/Introduction often are authors."""
    head = full_text[:4000]
    lines = [ln.strip() for ln in head.split("\n") if ln.strip()]
    # Find first section header
    section_start = None
    for i, ln in enumerate(lines):
        if re.match(
            r"^(Abstract|Introduction|Keywords|1\.\s|I\.\s)",
            ln,
            re.IGNORECASE,
        ):
            section_start = i
            break
    if section_start is None:
        section_start = len(lines)
    # Candidate author lines: before section, not the title, not too long
    title_lower = (title or "").lower()
    candidates = []
    for i in range(min(section_start, 15)):
        ln = lines[i]
        if not ln or len(ln) > 150:
            continue
        if title_lower and ln.lower() == title_lower:
            continue
        if re.match(r"^(DOI|https?://|©|Copyright|Published|Received|Accepted)\b", ln, re.IGNORECASE):
            continue
        if re.match(r"^\d+\.?\s*$", ln):
            continue
        candidates.append(ln)
    if not candidates:
        return []
    # One line with commas/semicolons → split; several lines → one author per line
    if len(candidates) == 1:
        return _parse_authors_from_metadata(candidates[0].replace(" and ", "; "))
    authors = []
    for c in candidates[:10]:
        # "Name1, Name2, and Name3" or "Name1 & Name2"
        for part in re.split(r",\s*and\s+|\s+and\s+|&", c):
            part = part.strip().rstrip(".,")
            if part and 2 <= len(part) <= 120:
                authors.append(part)
    return authors[:30] if authors else []


def extract_metadata(doc: fitz.Document, full_text: str) -> dict:
    """Métadonnées depuis le PDF (XMP / première page)."""
    meta = doc.metadata or {}
    title = (meta.get("title") or "").strip()
    authors: list[str] = []

    # Auteurs : d'abord XMP
    author_meta = (meta.get("author") or meta.get("authors") or "").strip()
    if author_meta:
        authors = _parse_authors_from_metadata(author_meta)

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

    # Auteurs depuis la première page si pas trouvés en XMP
    if not authors:
        authors = _extract_authors_from_first_page(full_text, title or None)

    return {
        "title": (clean_text_for_db(title).strip() or None) if title else None,
        "authors": authors,
        "doi": clean_text_for_db(doi).strip() if doi else None,
        "journal": clean_text_for_db(journal).strip() if journal else None,
        "published_at": published_at,
    }


# Sections reconnues : numérotées (1. Introduction) ou non, avec variantes
_SECTION_PATTERN = re.compile(
    r"^(?:\d+\.?\s*)?"
    r"(Abstract|Introduction|Methods?|Materials?\s+and\s+Methods?|Results?|Discussion|Conclusion|Conclusions?|References|Acknowledgments?|Acknowledgements?|Experimental|Background|Summary)\s*"
    r"(?:\s+and\s+Discussion)?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _chunk_one_page_text(text: str) -> list[tuple[str, str | None]]:
    """Découpe le texte d'une page en chunks (content, section_title)."""
    chunks_out: list[tuple[str, str | None]] = []
    current: list[str] = []
    current_len = 0
    section_title: str | None = None

    lines = text.split("\n")
    for line in lines:
        stripped = line.strip()
        match = _SECTION_PATTERN.match(stripped) if stripped else None
        if match:
            if current:
                block = "\n".join(current).strip()
                if block:
                    chunks_out.append((block, section_title))
            current = [line]
            current_len = len(line) + 1
            section_title = stripped
            continue
        current.append(line)
        current_len += len(line) + 1
        if current_len >= CHUNK_SIZE:
            block = "\n".join(current).strip()
            if block:
                chunks_out.append((block, section_title))
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
            chunks_out.append((block, section_title))

    return chunks_out


def chunk_text(text: str, page_texts: dict[int, str]) -> list[tuple[str, int | None, str | None]]:
    """Découpe en chunks par page pour avoir un numéro de page par chunk. (content, page, section_title)."""
    chunks_out: list[tuple[str, int | None, str | None]] = []
    if not page_texts:
        # Fallback sans page_texts : une seule "page"
        one_page_chunks = _chunk_one_page_text(text)
        for content, section_title in one_page_chunks:
            chunks_out.append((content, 1, section_title))
        return chunks_out if chunks_out else [(text[:8000].strip(), 1, None)]

    last_section: str | None = None
    for page_num in sorted(page_texts.keys()):
        page_content = page_texts[page_num]
        if not page_content.strip():
            continue
        page_chunks = _chunk_one_page_text(page_content)
        for content, section_title in page_chunks:
            # Propager la dernière section connue si ce chunk n'a pas de titre (début de page)
            title = section_title if section_title is not None else last_section
            if section_title is not None:
                last_section = section_title
            chunks_out.append((content, page_num, title))

    if not chunks_out:
        chunks_out = [(text[:8000].strip(), 1, None)]
    return chunks_out


def main():
    supabase = get_supabase()

    if not PDF_DIR.exists():
        print(f"Créer le dossier {PDF_DIR} et y déposer des PDF.")
        sys.exit(1)

    pdf_files = list(PDF_DIR.glob("*.pdf"))
    if not pdf_files:
        print(f"Aucun fichier .pdf dans {PDF_DIR}")
        sys.exit(0)

    print("Modèle d'embeddings (chargement unique)...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("all-MiniLM-L6-v2")

    print("Modèle de traduction EN→FR (chargement unique)...")
    from transformers import MarianMTModel, MarianTokenizer
    _trans_model = MarianMTModel.from_pretrained("Helsinki-NLP/opus-mt-en-fr")
    _trans_tokenizer = MarianTokenizer.from_pretrained("Helsinki-NLP/opus-mt-en-fr")
    _trans_device = _get_translation_device()
    _trans_model = _trans_model.to(_trans_device)
    print(f"  Traduction: device={_trans_device} (MPS=Chip Apple, CUDA=GPU Nvidia, cpu=CPU).", flush=True)

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
            print("  [1/6] Extraction texte PDF...", flush=True)
            full_text, page_texts, ocr_pages_count = extract_text_with_ocr_fallback(pdf_path)
            print(f"  [1/6] Texte extrait: {len(page_texts)} pages, {len(full_text)} caractères, OCR: {ocr_pages_count} pages.", flush=True)
            if not full_text.strip():
                raise ValueError("Aucun texte extrait (PDF vide ou OCR échoué).")

            doc_fitz = fitz.open(pdf_path)
            try:
                meta = extract_metadata(doc_fitz, full_text)
            finally:
                doc_fitz.close()

            # Log métadonnées documents (vérifier ce qu'on récupère)
            print("  [documents] Métadonnées extraites:", flush=True)
            title_val = meta.get("title") or "(vide)"
            print(f"    • title: {repr(title_val[:100])}{'...' if len(title_val) > 100 else ''}", flush=True)
            auth_list = meta.get("authors") or []
            print(f"    • authors: {len(auth_list)} auteur(s) → {auth_list[:3]}{' ...' if len(auth_list) > 3 else ''}", flush=True)
            print(f"    • doi: {repr(meta.get('doi') or '(vide)')}", flush=True)
            print(f"    • journal: {repr(meta.get('journal') or '(vide)')}", flush=True)
            print(f"    • published_at: {repr(meta.get('published_at') or '(vide)')}", flush=True)

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

            print("  [2/6] Chunking...", flush=True)
            chunks_data = chunk_text(full_text, page_texts)
            n_chunks = len(chunks_data)
            print(f"  [2/6] Chunking: {n_chunks} chunks.", flush=True)

            # Log chunks (page, section_title)
            with_page = sum(1 for _, p, _ in chunks_data if p is not None)
            with_section = sum(1 for _, _, st in chunks_data if st)
            section_counts: dict[str, int] = {}
            for _, _, st in chunks_data:
                if st:
                    section_counts[st] = section_counts.get(st, 0) + 1
            print("  [chunks] Statistiques:", flush=True)
            print(f"    • avec page: {with_page}/{n_chunks}", flush=True)
            print(f"    • avec section_title: {with_section}/{n_chunks}", flush=True)
            if section_counts:
                print(f"    • sections: {dict(sorted(section_counts.items(), key=lambda x: -x[1]))}", flush=True)

            contents_en = [c[0] for c in chunks_data]

            print("  [3/6] Embeddings EN...", flush=True)
            embeddings = model.encode(contents_en, show_progress_bar=False)
            print("  [3/6] Embeddings EN: fait.", flush=True)

            print("  [4/6] Traduction EN→FR...", flush=True)
            contents_fr = translate_en_to_fr_batch(contents_en, _trans_model, _trans_tokenizer, _trans_device)
            contents_fr_clean = [clean_text_for_db(t) for t in contents_fr]
            print("  [4/6] Traduction: fait.", flush=True)

            print("  [5/6] Embeddings FR...", flush=True)
            embeddings_fr = model.encode(contents_fr_clean, show_progress_bar=False)
            print("  [5/6] Embeddings FR: fait.", flush=True)

            INSERT_BATCH = 50
            print(f"  [6/6] Insert chunks (batches de {INSERT_BATCH})...", flush=True)
            rows_batch = []
            for pos, ((content, page, section_title), emb, content_fr, emb_fr) in enumerate(
                zip(chunks_data, embeddings, contents_fr_clean, embeddings_fr)
            ):
                row = {
                    "document_id": document_id,
                    "content": clean_text_for_db(content),
                    "position": pos,
                    "section_title": clean_text_for_db(section_title) if section_title else None,
                    "embedding": emb.tolist(),
                    "content_fr": content_fr,
                    "embedding_fr": emb_fr.tolist(),
                }
                if page is not None:
                    row["page"] = page
                rows_batch.append(row)
                if len(rows_batch) >= INSERT_BATCH:
                    supabase.table("chunks").insert(rows_batch).execute()
                    print(f"  [6/6] Insert: {min(pos + 1, n_chunks)}/{n_chunks} chunks.", flush=True)
                    rows_batch = []
            if rows_batch:
                supabase.table("chunks").insert(rows_batch).execute()
            print(f"  [6/6] Insert: {n_chunks}/{n_chunks} chunks.", flush=True)

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

            # Log console récap
            rec = "titre: oui" if meta.get("title") else "titre: non"
            rec += ", DOI: oui" if meta.get("doi") else ", DOI: non"
            rec += ", auteurs: oui" if meta.get("authors") else ", auteurs: non"
            rec += f", {len(chunks_data)} chunks"
            rec += f" (page: {with_page}/{n_chunks}, section: {with_section}/{n_chunks})"
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

    # Log récap : vérifier que la base est bien peuplée (chunks EN + FR)
    try:
        r_docs = supabase.table("documents").select("id", count="exact").eq("status", "done").execute()
        n_docs = r_docs.count if hasattr(r_docs, "count") and r_docs.count is not None else len(r_docs.data or [])
        r_chunks = supabase.table("chunks").select("id", count="exact").execute()
        n_chunks = r_chunks.count if hasattr(r_chunks, "count") and r_chunks.count is not None else len(r_chunks.data or [])
        r_fr = supabase.table("chunks").select("id", count="exact").not_.is_("content_fr", "null").execute()
        n_chunks_fr = r_fr.count if hasattr(r_fr, "count") and r_fr.count is not None else len(r_fr.data or [])
        print("[Ingestion] Base: {} document(s) done, {} chunk(s) total, {} chunk(s) avec content_fr.".format(n_docs, n_chunks, n_chunks_fr))
    except Exception as e:
        print(f"[Ingestion] Log récap non disponible: {e}")
    print("Terminé.")


if __name__ == "__main__":
    main()
