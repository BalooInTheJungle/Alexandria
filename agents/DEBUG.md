# DEBUG — Guide de diagnostic Alexandria

Procédures de debug adaptées à la stack Next.js + Supabase + Vercel.
Commencer par identifier le contexte de l'erreur, puis suivre la procédure correspondante.

---

## Identifier le contexte

| Symptôme | Contexte probable |
|----------|------------------|
| Erreur 500 dans le navigateur | API route Next.js |
| Réponse RAG vide ou garde-fou inattendu | Pipeline RAG |
| Run veille bloquée ou vide | Pipeline veille |
| PDF uploadé mais pas searchable | Pipeline ingestion |
| Erreur en production uniquement | Variable d'env manquante ou CORS |
| Erreur Supabase | Permissions RLS ou schéma DB |

---

## Debug API Route Next.js

### En local (npm run dev)

1. Regarder les logs du terminal (`console.log` dans les routes)
2. Ouvrir les DevTools → onglet Network → trouver la requête → lire la réponse
3. Format des logs attendu :
```
[routeName] input: { ... }
[routeName] result: { ... }
[routeName] error: { message, stack }
```

### En production (Vercel)

```bash
# Voir les logs en temps réel
vercel logs --follow

# Filtrer par route
vercel logs --follow | grep "/api/rag"
```

Ou : Dashboard Vercel → projet → onglet Logs → filtrer par fonction.

---

## Debug Pipeline RAG

### Checklist quand le RAG ne répond pas correctement

1. **Aucune réponse / erreur 500**
   - Vérifier `OPENAI_API_KEY` dans les env Vercel (uniquement ASCII imprimables)
   - Vérifier que la route `/api/rag/chat` existe et est bien exportée

2. **Garde-fou toujours déclenché**
   - Vérifier `rag_settings.similarity_threshold` en base (trop élevé ?)
   - Vérifier que des chunks existent en base : `SELECT COUNT(*) FROM chunks`
   - Vérifier que les embeddings sont non-null : `SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL`

3. **Réponse dans la mauvaise langue**
   - Vérifier `lib/rag/detect-lang.ts` — la détection est-elle correcte pour cette requête ?
   - Vérifier que les chunks FR existent : `SELECT COUNT(*) FROM chunks WHERE embedding_fr IS NOT NULL`

4. **Citations incorrectes ou manquantes**
   - Vérifier `lib/rag/citations.ts`
   - Vérifier que `document_id` est bien dans chaque chunk retourné

### Tester la recherche seule

```bash
# Appel direct à la route de recherche (sans LLM)
curl -X POST http://localhost:3000/api/rag/search \
  -H "Content-Type: application/json" \
  -d '{"query": "spin crossover", "lang": "en"}'
```

---

## Debug Pipeline Veille

### Checklist quand la veille ne fonctionne pas

1. **Run reste en status "running"**
   - Vérifier les logs Vercel pour la route `/api/veille/scrape`
   - Vérifier si une exception non catchée a interrompu le pipeline
   - Mettre à jour manuellement le run : `UPDATE veille_runs SET status='failed' WHERE status='running'`

2. **Aucun article trouvé**
   - Tester manuellement : `npx tsx scripts/test-veille.ts`
   - Vérifier que les sources sont bien en base : `SELECT COUNT(*) FROM sources WHERE active = true`
   - Vérifier la connectivité réseau vers les sources RSS

3. **Score toujours à 0 ou null**
   - Vérifier que des chunks EN avec embedding existent en base
   - Vérifier `lib/veille/score.ts` — l'embedding de l'abstract est-il calculé ?

4. **Doublons dans les articles**
   - Vérifier la déduplication par DOI dans `lib/veille/`
   - Vérifier `getKnownDois()` — retourne-t-il les DOIs déjà en base ?

### Lancer un test de veille

```bash
npx tsx scripts/test-veille.ts
```

---

## Debug Ingestion PDF

### Checklist après upload PDF

1. **Document créé mais status "processing" ou "error"**
   ```sql
   SELECT id, title, status, ingestion_log FROM documents ORDER BY created_at DESC LIMIT 5;
   ```
   Le champ `ingestion_log` contient le détail de l'erreur.

2. **Chunks non créés après ingestion**
   ```sql
   SELECT d.title, COUNT(c.id) as chunks
   FROM documents d
   LEFT JOIN chunks c ON c.document_id = d.id
   GROUP BY d.id, d.title
   ORDER BY d.created_at DESC LIMIT 5;
   ```

3. **Embeddings FR manquants**
   ```sql
   SELECT COUNT(*) FROM chunks WHERE embedding_fr IS NULL;
   ```
   → Si élevé : relancer `scripts/ingest.py` sur les documents concernés.

4. **PDF non reconnu (OCR nécessaire)**
   - Le log d'ingestion indiquera "OCR fallback activated"
   - Vérifier que `tesseract` est installé : `tesseract --version`

---

## Debug Base de Données (Supabase)

### Vérifications rapides

```sql
-- Nombre de documents et chunks
SELECT 
  (SELECT COUNT(*) FROM documents WHERE status = 'done') as docs_done,
  (SELECT COUNT(*) FROM documents WHERE status = 'error') as docs_error,
  (SELECT COUNT(*) FROM chunks) as total_chunks,
  (SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL) as chunks_with_embed,
  (SELECT COUNT(*) FROM chunks WHERE embedding_fr IS NOT NULL) as chunks_with_embed_fr;

-- Sources (la colonne active n'existe pas encore avant la migration sources_active.sql)
SELECT COUNT(*), source_type FROM sources GROUP BY source_type;

-- Dernier run veille
SELECT id, status, created_at, item_count, scored_count 
FROM veille_runs 
ORDER BY created_at DESC LIMIT 3;

-- Paramètres RAG actuels
SELECT * FROM rag_settings;
```

### Erreurs RLS fréquentes

- `new row violates row-level security` → utiliser `admin.ts` pour les opérations système
- `permission denied for table` → vérifier le client utilisé (server.ts vs admin.ts)

---

## Debug Variables d'Environnement

### En local

```bash
# Vérifier que .env.local est bien chargé
node -e "require('dotenv').config({path:'.env.local'}); console.log(Object.keys(process.env).filter(k => k.includes('SUPABASE') || k.includes('OPENAI')))"
```

### En production (Vercel)

Dashboard Vercel → Settings → Environment Variables → vérifier que toutes les variables sont présentes et non vides.

Variables requises :
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `CRON_SECRET`

---

## Références

- `docs/ERRORS.md` — erreurs connues et solutions documentées
- `documentation/BACK_RAG.md` — spécifications détaillées de la pipeline RAG
- `documentation/PIPELINE_VEILLE_CONSOLIDE.md` — pipeline veille détaillée
