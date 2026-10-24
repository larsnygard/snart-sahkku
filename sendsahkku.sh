#!/usr/bin/env bash
# Deploy SnartSahkku to https://snart.com/sahkku
#
# Whole-project rsync into the shared webroot's sahkku/ subdirectory,
# excluding VCS, dev tooling, Rust build cache (see .rsync-exclude).
# Static only; the iroh wasm module ships prebuilt in net/pkg.
set -euo pipefail

HOST="proisp"
DEST="$(ssh -o BatchMode=yes "$HOST" 'readlink -f "$HOME/www/sahkku"')"

# create the target directory on the host first (idempotent)
ssh "$HOST" "mkdir -p '$DEST'"

rsync -avz --delete \
  --exclude-from="$(git rev-parse --show-toplevel)/.rsync-exclude" \
  "$(git rev-parse --show-toplevel)/" "$HOST":"$DEST"/

echo
echo "Deployed to: https://snart.com/sahkku/"
echo "  remote:    $DEST"
echo "  files:     $(ssh "$HOST" "find '$DEST' -type f | wc -l")"
