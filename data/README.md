# Dossier data — Alexandria

## `pdfs/`

**Rôle** : dépôt local des PDF à indexer pour le RAG.

- Déposez vos PDF dans `data/pdfs/`.
- Le processus d’ingestion (lancé à la main) lit ce dossier, parse les PDF, extrait les métadonnées (titre, auteurs, DOI, journal, date), découpe en chunks, génère les embeddings et enregistre tout en base (documents + chunks).
- `documents.storage_path` en base stocke le **chemin relatif** vers le fichier (ex. `data/pdfs/mon-article.pdf`) pour retrouver le document.
- Les fichiers `*.pdf` dans `data/pdfs/` sont ignorés par Git (voir `.gitignore`) ; seuls la structure du projet et ce README sont versionnés.

**Ingestion** : script Python `scripts/ingest.py` (dépendances : `pip install -r scripts/requirements.txt`). Prévoir **Poppler** et **Tesseract** pour l’OCR des PDF scannés. Voir `scripts/README.md`.  
**Référence** : voir `documentation/RAG_REFERENCE.md` pour le flux d’ingestion et la recherche RAG.
