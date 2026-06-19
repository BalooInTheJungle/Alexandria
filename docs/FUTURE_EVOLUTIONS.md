# FUTURE EVOLUTIONS — Alexandria

Évolutions identifiées post-V1.9. Aucune n'est bloquante pour l'usage actuel.
Dernière mise à jour : juin 2026.

---

## Priorité haute

### Recalculer l'UMAP sur le corpus actuel
- **Quoi** : relancer `scripts/compute_umap.py` pour mettre à jour les colonnes `chunks.umap_x / umap_y`
- **Pourquoi** : le scatter plot de la page Database est périmé (calculé sur un corpus plus petit)
- **Effort** : ~30 min (script déjà prêt)
- **Commande** : `cd scripts && python3 compute_umap.py`

### Nettoyage automatique des analyses expirées
- **Quoi** : supprimer les `document_analyses` avec `expires_at < now()` et `is_integrated = false`
- **Pourquoi** : le champ `expires_at` existe mais aucun cron ne l'exploite — les chunks temporaires s'accumulent
- **Options** : trigger Supabase sur `expires_at`, ou ajout dans le cron de rétention (`/api/cron/retention`)
- **Effort** : ~1h

### Clé API Semantic Scholar
- **Quoi** : ajouter `SS_API_KEY` dans les secrets GitHub Actions
- **Pourquoi** : sans clé, la limite est 1 req/s → rate limits fréquents sur le Job 1b
- **Statut** : formulaire de demande soumis à Semantic Scholar
- **Action** : dès réception de la clé, l'ajouter dans les secrets du repo GitHub

---

## Module Veille — améliorations

### Filtres sur la liste articles
- Filtrer par auteur, journal, plage de dates, score minimum
- Actuellement : liste plate, seul le score minimum est configurable

### Lien "Analyser cet article" depuis la veille
- Sur chaque `VeilleArticleCard`, ajouter un bouton qui ouvre `/analyse` avec le PDF pré-rempli (si URL disponible) ou redirige vers l'upload
- Aujourd'hui : le chemin veille → analyse est manuel

### Notifications veille
- Email ou push quand un run produit des articles au-dessus d'un seuil personnalisé
- Utile si le chercheur ne consulte pas l'app tous les matins

### Export de la sélection veille
- Export CSV ou PDF des articles pertinents d'un run
- Usage : partager avec des collègues, archiver dans un outil de gestion bibliographique

---

## Module Analyse — améliorations

### Historique des analyses
- La page `/analyse` n'affiche que le formulaire d'upload
- Ajouter la liste des analyses passées (titre, date, statut, bouton "Rouvrir")
- La table `document_analyses` stocke déjà tout — c'est uniquement une question d'UI

### Analyse depuis un abstract (sans PDF)
- Pour les articles identifiés en veille dont le PDF n'est pas accessible librement
- Niveau 1 : résumé sur abstract seul (déjà possible techniquement avec GPT)
- Niveau 2 : chunks du corpus uniquement pour la Discussion

### Amélioration de l'extraction de références citées
- Actuellement : regex sur le texte complet → faux positifs, DOIs partiels
- Amélioration : parser spécifiquement la section "References" + normalisation DOI
- Impact : meilleur croisement `cited_refs` avec le corpus

### Comparaison de deux articles
- "Compare cet article avec [article du corpus]"
- Dans la Discussion, permettre de sélectionner un document du corpus comme référence explicite

---

## Base de données & corpus

### Extension du corpus 2015-2023
- ~13 000 PDFs supplémentaires disponibles
- Contrainte : DB actuellement à ~7 Go sur plan Pro (limite 8 Go) — nécessite upgrade ou nettoyage
- Si upgrade : ~50$/mois (plan Pro 8 Go → 16 Go)

### Index UMAP incrémental
- Actuellement : recalcul complet à chaque fois (lent sur 848k chunks)
- Amélioration : UMAP incrémental ou recalcul seulement sur les nouveaux chunks

---

## Infrastructure

### Multi-utilisateurs
- Actuellement : conçu pour un seul chercheur (RLS par user_id déjà en place)
- Évolution : inviter des collègues avec accès partagé au corpus et à la veille
- Nécessite : UI de gestion des accès, corpus partagé vs corpus personnel

### Feedback utilisateur sur les scores veille
- Marquer un article comme "pertinent" ou "non pertinent" depuis l'UI
- Utiliser ce signal pour affiner le scoring (fine-tuning du seuil ou pondération par journal/auteur)

### Tableau de bord qualité pipeline
- Taux de réussite/échec par job GitHub Actions
- Évolution du score moyen sur les 30 derniers runs
- Alertes si un run produit 0 articles (probable erreur source)

---

## Évolutions non prioritaires

| Évolution | Raison de report |
|-----------|-----------------|
| OCR amélioré (figures, tableaux) | Complexité élevée, faible impact sur le texte |
| Rapport hebdomadaire email | Infrastructure email à configurer |
| Exploration libre du corpus (clustering) | UMAP déjà disponible, clustering à construire par-dessus |
| Score personnalisé par auteur/labo | Nécessite un mécanisme de feedback d'abord |
| Migration PDFs vers Supabase Storage | ~100 Go, coût storage à évaluer |
