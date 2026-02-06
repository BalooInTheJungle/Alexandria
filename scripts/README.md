# Scripts d’ingestion — Alexandria

## Prérequis

- **Python 3.10+**
- **Poppler** (pour `pdf2image`) :  
  - macOS : `brew install poppler`  
  - Ubuntu/Debian : `sudo apt install poppler-utils`
- **Tesseract** (pour l’OCR des PDF scannés) :  
  - macOS : `brew install tesseract tesseract-lang`  
  - Ubuntu/Debian : `sudo apt install tesseract-ocr tesseract-ocr-eng`

## Installation

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

## Migration Supabase (embedding 384)

Si tu utilises le modèle open source **all-MiniLM-L6-v2** (384 dimensions), exécuter la migration :

`supabase/migrations/20260204100006_chunks_embedding_384.sql`

(dans le SQL Editor Supabase, ou `supabase db push`).  
Si la table `chunks` contient déjà des lignes avec des embeddings en 1536, elles seront perdues ; ré-ingérer après.

## Lancer l’ingestion

1. Déposer des PDF dans **data/pdfs/**.
2. À la racine du projet :

```bash
python3 scripts/ingest.py
```

Le script :

- Parcourt tous les **.pdf** de `data/pdfs/`.
- Ignore les PDF déjà indexés (même `storage_path` en base).
- Pour chaque PDF :
  - Extrait le texte (PyMuPDF) ; si une page a très peu de texte, tente l’**OCR** (Tesseract) sur cette page.
  - Extrait les métadonnées (titre, DOI, etc.) depuis le PDF.
  - Découpe en chunks (sections ou taille fixe + overlap).
  - Génère les embeddings (sentence-transformers **all-MiniLM-L6-v2**, 384D).
  - Insère une ligne dans **documents** puis les **chunks** en base.
- En cas d’erreur : le **document** est mis en `status = error` avec `error_message` ; les chunks déjà insérés restent (on ne les supprime pas).

## Test avec 2–3 documents

1. Mettre 2 ou 3 PDF dans **data/pdfs/**.
2. Exécuter la migration **20260204100006_chunks_embedding_384.sql** si ce n’est pas déjà fait.
3. Lancer `python scripts/ingest.py`.
4. Vérifier dans Supabase : table **documents** (status = done), table **chunks** (lignes avec `document_id`, `content`, `embedding` non nul).

## Référence

- **documentation/RAG_REFERENCE.md** : pipeline RAG, ingestion, fallback OCR.
- **documentation/INGESTION_EMBEDDING.md** : paramètres (CHUNK_SIZE, overlap, modèle, etc.) et flow détaillé d’embedding.
- **documentation/AVANT_EXTRACTION.md** : points à surveiller avant une extraction massive (~10k PDF).
