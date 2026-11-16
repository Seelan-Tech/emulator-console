#!/usr/bin/env bash
# Create or update the "main" branch ruleset from main.json.
# Rulesets need a public repository (or a paid plan), so run this once the repository is public:
#   .github/rulesets/apply.sh [owner/repo]
set -euo pipefail
cd "$(dirname "$0")"
repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
id=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id')
if [ -n "$id" ]; then
  gh api -X PUT "repos/$repo/rulesets/$id" --input main.json --jq '"updated ruleset \(.id)"'
else
  gh api -X POST "repos/$repo/rulesets" --input main.json --jq '"created ruleset \(.id)"'
fi
