# Scripts d’ingestion — Alexandria

Alexandria propose **deux modes d’ingestion** des PDF :

| Mode | Source | Usage |
|------|--------|-------|
| **API upload** | Page **Database** (glisser-déposer) | Usage principal : upload via l’interface, traitement en mémoire, pas de stockage fichier. |
| **Script Python** | Dossier **data/pdfs/** | Ingestion en lot : déposer des PDF dans le dossier, lancer le script en ligne de commande. |

---

## Mode 1 : API upload (recommandé pour l’usage courant)

- **Page** : `/database` (Database → Ajouter des documents).
- **API** : `POST /api/documents/upload` (multipart/form-data, max 10 fichiers, 20 Mo chacun).
- **Pipeline** : `lib/ingestion/` → parse (pdf-parse), chunk (paragraphes, 400 car., overlap 50), embed (Xenova/all-MiniLM-L6-v2 côté Node).
- **Dédup** : si le PDF contient un DOI déjà présent en base (status = done) → skip, pas de doublon.
- **Stockage** : les PDF ne sont **pas conservés** après ingestion ; `storage_path` = `upload/{uuid}.pdf` (chemin logique).
- **Bilingue** : `content_fr` et `embedding_fr` sont pour l’instant une copie du contenu EN (pas de traduction côté API).

Voir `documentation/BACK_RAG.md` §5 pour le détail.

---

## Mode 2 : Script Python (ingestion en lot depuis data/pdfs/)

### Prérequis

- **Python 3.10+**
- **Poppler** (pour `pdf2image`) :  
  - macOS : `brew install poppler`  
  - Ubuntu/Debian : `sudo apt install poppler-utils`
- **Tesseract** (pour l’OCR des PDF scannés) :  
  - macOS : `brew install tesseract tesseract-lang`  
  - Ubuntu/Debian : `sudo apt install tesseract-ocr tesseract-ocr-eng`

### Installation

À la racine du projet, utilise **le même Python** que pour lancer le script (éviter `pip` / `python3` différents) :

```bash
python3 -m pip install -r scripts/requirements.txt
```

Ou avec un venv (recommandé) :

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r scripts/requirements.txt
```

### Variables d’environnement

Le script lit **.env.local** (ou **.env**) à la racine du projet. Pas besoin de lancer Next.js.

Crée le fichier à la racine (copie de `.env.local.example` puis remplis les valeurs) :

```bash
cp .env.local.example .env.local
```

Renseigne au minimum :

| Variable | Où la trouver |
|----------|----------------|
| **NEXT_PUBLIC_SUPABASE_URL** | Supabase → ton projet → **Settings** (icône engrenage) → **API** → **Project URL** |
| **SUPABASE_SERVICE_ROLE_KEY** | Même page **Settings → API** → **Project API keys** → **service_role** (clé secrète, à ne pas exposer côté navigateur) |

- **Project URL** : une URL du type `https://xxxxx.supabase.co`
- **service_role** : une longue clé (commence souvent par `eyJ...` ou `sbp_...`). Ne la mets **jamais** dans du code front ou dans un repo public.

Tu peux aussi définir **SUPABASE_URL** au lieu de **NEXT_PUBLIC_SUPABASE_URL** : le script accepte les deux.

### Migrations Supabase

Exécuter les migrations suivantes (dans le SQL Editor Supabase, ou `npx supabase db push`) :

| Migration | Rôle |
|-----------|------|
| `20260204100006_chunks_embedding_384.sql` | Embedding 384D (all-MiniLM-L6-v2). Si la table `chunks` contient déjà des lignes en 1536D, elles seront perdues ; ré-ingérer après. |
| `20260205100000_documents_ingestion_log.sql` | Colonne `ingestion_log` sur `documents`. |
| `20260206100000_chunks_bilingue_fr.sql` | Colonnes `content_fr`, `embedding_fr`, `content_fr_tsv` ; trigger FTS french ; RPC `match_chunks_fr`, `search_chunks_fts_fr`. |

### Lancer l’ingestion

1. Déposer des PDF dans **data/pdfs/**.
2. À la racine du projet :

```bash
python3 scripts/ingest.py
```

Le script :

- Parcourt tous les **.pdf** de `data/pdfs/`.
- Ignore les PDF déjà indexés (même `storage_path` en base avec status = done).
- Pour les documents en **error** ou **processing** : supprime document + chunks puis ré-ingère.
- Pour chaque PDF :
  - Extrait le texte (PyMuPDF) ; si une page a très peu de texte, tente l’**OCR** (Tesseract) sur cette page.
  - Extrait les métadonnées (titre, DOI, auteurs, etc.) depuis le PDF.
  - Découpe en chunks (sections ou taille fixe + overlap).
  - Génère les embeddings (sentence-transformers **all-MiniLM-L6-v2**, 384D).
  - **Traduit EN→FR** (Helsinki-NLP/opus-mt-en-fr) → `content_fr`, `embedding_fr`.
  - Insère une ligne dans **documents** puis les **chunks** en base.
- En cas d’erreur : le **document** est mis en `status = error` avec `error_message` ; les chunks déjà insérés restent (on ne les supprime pas).

### Paramètres (ingest.py)

| Paramètre | Valeur | Rôle |
|-----------|--------|------|
| PDF_DIR | data/pdfs | Dossier des PDF. |
| CHUNK_SIZE | 600 | Taille cible d’un bloc (caractères). |
| CHUNK_OVERLAP | 100 | Recouvrement entre deux chunks. |
| MIN_TEXT_PER_PAGE | 50 | Seuil en dessous duquel on tente l’OCR. |
| TRANSLATE_BATCH_SIZE | 24 | Nombre de textes par batch de traduction (MarianMT). |
| INSERT_BATCH | 50 | Chunks insérés par batch en base. |

### Test avec 2–3 documents

1. Mettre 2 ou 3 PDF dans **data/pdfs/**.
2. Exécuter les migrations si ce n’est pas déjà fait.
3. Lancer `python3 scripts/ingest.py`.
4. Vérifier dans Supabase : table **documents** (status = done), table **chunks** (lignes avec `document_id`, `content`, `content_fr`, `embedding`, `embedding_fr` non nuls).

---

## Comparaison des deux modes

| Aspect | API upload | Script Python |
|--------|------------|---------------|
| **Source** | Upload UI (page Database) | data/pdfs/ |
| **Parse PDF** | pdf-parse (Node) | PyMuPDF |
| **OCR** | Non | Oui (Tesseract si page peu textuelle) |
| **Chunk** | Paragraphes, 400 car., overlap 50 | Sections + taille 600, overlap 100 ; page, section_title |
| **Embedding** | Xenova (Node, all-MiniLM-L6-v2) | sentence-transformers (Python, même modèle) |
| **Traduction EN→FR** | Non (content_fr = content) | Oui (opus-mt-en-fr) |
| **Dédup** | Par DOI | Par storage_path |
| **Stockage fichier** | Aucun (buffer en mémoire) | data/pdfs/ ; storage_path = data/pdfs/{nom}.pdf |

---

## Références

- **documentation/BACK_RAG.md** : détail des deux pipelines d’ingestion, recherche RAG, paramètres.
- **documentation/SCHEMA_DB_ET_DONNEES.md** : tables `documents`, `chunks`, migrations.
