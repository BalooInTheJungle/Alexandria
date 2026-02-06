# Points à surveiller avant une extraction massive

Avant de lancer l’ingestion sur l’intégralité des documents (ex. ~10 000 PDF), vérifier les points suivants.

---

## 1. Configuration et migrations

| Point | Action |
|-------|--------|
| **Migration 384** | La colonne `chunks.embedding` doit être en **vector(384)**. Exécuter `supabase/migrations/20260204100006_chunks_embedding_384.sql` si ce n’est pas déjà fait. |
| **Migration ingestion_log** | La colonne `documents.ingestion_log` (jsonb) doit exister. Exécuter `supabase/migrations/20260205100000_documents_ingestion_log.sql`. |
| **Variables d’environnement** | `.env.local` à la racine avec **NEXT_PUBLIC_SUPABASE_URL** (URL projet `https://xxx.supabase.co`) et **SUPABASE_SERVICE_ROLE_KEY**. Le script lit ce fichier sans lancer Next.js. |

---

## 2. Environnement d’exécution

| Point | Action |
|-------|--------|
| **Python / pip** | Utiliser le même interpréteur pour installer et lancer : `python3 -m pip install -r scripts/requirements.txt` puis `python3 scripts/ingest.py`. |
| **Poppler** | Requis pour `pdf2image` (OCR). macOS : `brew install poppler` ; Ubuntu/Debian : `apt install poppler-utils`. |
| **Tesseract** | Requis pour l’OCR des pages peu textuelles. macOS : `brew install tesseract tesseract-lang` ; Ubuntu/Debian : `apt install tesseract-ocr tesseract-ocr-eng`. |
| **Espace disque** | Modèle sentence-transformers (~90 Mo) + cache Hugging Face. Pour 10k PDF, prévoir aussi de la RAM (batch d’embeddings par document). |
| **Réseau** | Premier run : téléchargement du modèle depuis Hugging Face. Ensuite, uniquement les appels à Supabase (API). |

---

## 3. Données et idempotence

| Point | Action |
|-------|--------|
| **Dossier PDF** | Tous les PDF à ingérer sont dans **data/pdfs/** (extension `.pdf`). Pas d’autres types de fichiers traités. |
| **Déjà indexés** | Les PDF déjà présents en base avec **status = done** et le même **storage_path** sont **ignorés** (skip). Pas de doublon d’ingestion. |
| **Échecs / interrompus** | Les documents en **status = error** ou **processing** sont **supprimés** (document + chunks) puis **ré-ingérés** au prochain run. Tu peux relancer le script après une interruption. |

---

## 4. Limites et volume

| Point | À surveiller |
|-------|----------------|
| **Supabase** | Quotas du projet (lignes, stockage, requêtes). ~10k documents + ~100–200 chunks/doc → ordre de grandeur 1–2 M de lignes dans `chunks`. Vérifier les limites du plan. |
| **Temps d’exécution** | Plusieurs heures à dizaines d’heures selon le volume et la machine. Lancer en **screen** / **tmux** ou en tâche de fond pour éviter une coupure par fermeture du terminal. |
| **Interruption** | En cas de Ctrl+C, le document en cours reste en **processing** ; au prochain run il sera supprimé et ré-ingéré. Les documents déjà en **done** ne sont pas modifiés. |

---

## 5. Qualité et logs

| Point | Action |
|-------|--------|
| **ingestion_log** | Chaque document **done** a un **ingestion_log** (titre/DOI/chunks/OCR). Consulter en base pour repérer les PDF avec peu de métadonnées ou beaucoup de pages OCR. |
| **Console** | Le script affiche par PDF : titre/DOI/auteurs (oui/non), nombre de chunks, pages OCR. Utile pour surveiller le déroulement. |
| **Erreurs** | Les PDF en **error** ont **error_message** et **ingestion_log** avec `{"error": "..."}`. Corriger (ex. caractères invalides, PDF corrompu) ou ignorer. |

---

## 6. Checklist rapide

- [ ] Migrations 384 et ingestion_log exécutées.
- [ ] `.env.local` avec URL projet Supabase + `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] `python3 -m pip install -r scripts/requirements.txt` (et Poppler + Tesseract installés).
- [ ] PDF à ingérer présents dans **data/pdfs/**.
- [ ] Pour un gros volume : lancer dans **screen** / **tmux** ou en arrière-plan.
- [ ] Après le run : contrôler en base **documents** (status, ingestion_log) et **chunks** (nombre, embedding non nul).

Référence du flow et des paramètres : **documentation/INGESTION_EMBEDDING.md**.
