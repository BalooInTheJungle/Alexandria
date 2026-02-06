# Ingestion et embedding — paramètres et flow

**Objectif** : référence des paramètres et du flux utilisés par le script d’ingestion (`scripts/ingest.py`) pour l’extraction PDF → chunks → embeddings → Supabase.

---

## 1. Flow global

```
data/pdfs/*.pdf
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Liste des PDF (glob *.pdf)                                    │
│    → Skip si storage_path déjà en base avec status = done         │
│    → Si status = error ou processing : suppression doc + chunks    │
│      puis ré-ingestion                                            │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. Extraction texte (par PDF)                                     │
│    • PyMuPDF (fitz) : page.get_text() par page                    │
│    • Si nb caractères page < MIN_TEXT_PER_PAGE → OCR (Tesseract)  │
│    • Nettoyage : clean_text_for_db() (suppression \x00 / \u0000)  │
│    → full_text, page_texts, ocr_pages_count                       │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. Métadonnées (depuis PDF + heuristiques sur full_text)          │
│    • Titre : XMP metadata ou première grosse ligne (< 3000 car)   │
│    • DOI : regex 10.\d{4,}/[^\s]+ sur les 10 000 premiers car    │
│    • Auteurs, journal, date : non implémentés (null)              │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. Insert document (status = processing)                          │
│    → document_id                                                  │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. Chunking                                                       │
│    • Détection sections : Abstract, Introduction, Methods,       │
│      Results, Discussion, Conclusion, References, Acknowledgments  │
│    • Découpe par section ; à l’intérieur d’une section :          │
│      blocs de CHUNK_SIZE caractères avec CHUNK_OVERLAP en recouvrement │
│    • Fallback : 1 chunk = texte tronqué à 8000 car               │
│    → liste de (content, page, section_title)                      │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 6. Embeddings                                                     │
│    • Modèle : sentence-transformers/all-MiniLM-L6-v2             │
│    • Dimension : 384                                              │
│    • Encode tous les content en une fois (batch)                 │
│    → vecteurs shape (n_chunks, 384)                               │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 7. Écriture en base                                               │
│    • Pour chaque chunk : insert chunks (content, document_id,     │
│      position, page, section_title, embedding)                    │
│    • content_tsv rempli par trigger Postgres (to_tsvector english)│
│    • Update document : status = done, ingestion_log = {...}       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Paramètres (scripts/ingest.py)

| Paramètre | Valeur | Rôle |
|-----------|--------|------|
| **PDF_DIR** | `project_root / "data" / "pdfs"` | Dossier des PDF à traiter. |
| **EMBED_DIM** | `384` | Dimension des vecteurs (modèle all-MiniLM-L6-v2). Doit correspondre à la colonne `chunks.embedding` (migration 384). |
| **CHUNK_SIZE** | `600` | Taille cible d’un bloc en **caractères** (hors sections). Au-delà, un nouveau chunk est créé. |
| **CHUNK_OVERLAP** | `100` | Nombre de caractères de **recouvrement** entre deux chunks consécutifs (évite de couper au milieu d’une phrase). |
| **MIN_TEXT_PER_PAGE** | `50` | Seuil en **caractères** par page. Si une page a moins de texte, on tente l’OCR (Tesseract) sur cette page. |

### 2.1 Sections reconnues (chunking)

Expressions rationnelles (insensibles à la casse) pour détecter un titre de section :

- `Abstract`
- `Introduction`
- `Methods` / `Method`
- `Results`
- `Discussion`
- `Conclusion`
- `References`
- `Acknowledgments` / `Acknowledgements`

Un bloc de texte qui précède une de ces lignes est fermé comme chunk ; la section suivante démarre un nouveau bloc.

### 2.2 Modèle d’embeddings

| Élément | Valeur |
|--------|--------|
| **Modèle** | `sentence-transformers/all-MiniLM-L6-v2` |
| **Dimension** | 384 |
| **Usage** | Indexation des chunks et (à faire) embedding des requêtes pour la recherche vectorielle. |
| **Chargement** | Une fois au début du script ; puis `model.encode(liste_de_texte)` en batch par document. |

---

## 3. Nettoyage et contraintes base

- **clean_text_for_db(text)** : remplace `\x00` et `\u0000` par un espace (Postgres n’accepte pas le caractère nul en `text`).
- Appliqué à : `full_text`, métadonnées (titre, DOI, etc.), `content` et `section_title` de chaque chunk avant insertion.

---

## 4. Log d’ingestion (ingestion_log)

Pour chaque document, après traitement, le champ **documents.ingestion_log** (jsonb) est rempli avec :

| Clé | Type | Description |
|-----|------|-------------|
| title_extracted | bool | Titre extrait ou non. |
| doi_extracted | bool | DOI extrait ou non. |
| authors_extracted | bool | Auteurs extraits ou non (souvent false). |
| journal_extracted | bool | Journal extrait ou non. |
| published_at_extracted | bool | Date extraite ou non. |
| chunks_count | int | Nombre de chunks insérés. |
| ocr_pages_count | int | Nombre de pages passées en OCR. |
| ingested_at | string | Date/heure de fin d’ingestion (ISO 8601). |

En cas d’erreur : `{"error": "message", "ingested_at": "..."}`.

---

## 5. Références

- **scripts/ingest.py** : implémentation du flow.
- **scripts/README.md** : prérequis, installation, lancement.
- **documentation/RAG_REFERENCE.md** : contexte RAG et ingestion.
- **documentation/SCHEMA_SUPABASE.md** : schéma des tables `documents` et `chunks`, colonne `embedding` (384).
