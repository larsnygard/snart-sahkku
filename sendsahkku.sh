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

# Pensjonerte motorar: ligg i repoet, men skal ikkje liggje på nettet. Sidan
# rsync --delete ikkje fjernar filer som er ekskluderte, tek vi dei bort her.
echo -n "Fjernar pensjonerte motorar → "
ssh -o BatchMode=yes "$HOST" "cd '$DEST/engines' && rm -f \
  ail0.{1,2,3,4,5,6,7,8}.js ail0.{1,2,3,4,5,6,7,8}.weights.json \
  nais{1,2,3}.js nais{1,2,3}.weights.json && echo ok"

# Varnish står framfor webrota og cache-lagrar index.html lenge. Utan ein purge
# får folk den GAMLE appen sjølv om filene på serveren er nye (han kan ikkje
# purgast utanfrå: PURGE frå internett gjev 401/405, og 404 på enkeltfiler
# tyder berre «ikkje i cache»). Difor: purg frå verten sjølv etter rsync.
echo
echo -n "Varnish-purge /sahkku/ → "
ssh -o BatchMode=yes "$HOST" \
  'curl -s -o /dev/null -w "%{http_code}\n" -X PURGE "https://snart.com/sahkku/"'

echo
echo "Deployed to: https://snart.com/sahkku/"
echo "  remote:    $DEST"
echo "  files:     $(ssh "$HOST" "find '$DEST' -type f | wc -l")"
echo -n "  live no:   "
curl -s https://snart.com/sahkku/ | grep -oE 'v1[.][0-9]+[.][0-9]+' | head -1

