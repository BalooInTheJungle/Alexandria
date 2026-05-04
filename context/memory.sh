#!/bin/bash
# memory.sh — Snapshot git du projet Alexandria
# Usage : bash context/memory.sh [message]
# Crée un commit de sauvegarde avec l'état actuel (hors fichiers ignorés)

set -e

MESSAGE="${1:-snapshot: session $(date +%Y-%m-%d)}"
BRANCH="memory/$(date +%Y-%m-%d)"

echo "=== Alexandria Memory Snapshot ==="
echo "Message  : $MESSAGE"
echo "Branche  : $BRANCH"
echo ""

# Afficher l'état avant commit
echo "--- Fichiers modifiés ---"
git status --short
echo ""

# Créer ou basculer sur la branche memory
if git show-ref --quiet "refs/heads/$BRANCH"; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

# Stager tous les fichiers trackés (hors .gitignore)
git add -A

# Vérifier s'il y a des changements à committer
if git diff --cached --quiet; then
  echo "Aucun changement à committer."
  git checkout -
  exit 0
fi

# Commit
git commit -m "$MESSAGE"

echo ""
echo "✓ Snapshot créé sur la branche $BRANCH"
echo ""

# Retourner sur la branche d'origine
ORIGINAL=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
if [ "$ORIGINAL" != "$BRANCH" ]; then
  git checkout -
fi

echo "Branche actuelle : $(git branch --show-current)"
echo ""
echo "Pour voir le snapshot : git log $BRANCH --oneline"
echo "Pour revenir : git checkout main"
