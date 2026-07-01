#!/usr/bin/env bash
# Push an add-on's options to Supervisor from a local JSON file, then restart it.
#
# The options file holds the add-on's option keys directly (same shape as the
# `options:` block in config.yaml). It is gitignored (contains secrets).
#
#   ADDON=actual_capture bash scripts/configure_addon.sh
#   OPTS_FILE=addons/actual_capture/.options.json ADDON=actual_capture bash scripts/configure_addon.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ADDON="${ADDON:-actual_capture}"
export SLUG="${SLUG:-local_$ADDON}"
HA="bash $REPO_ROOT/scripts/ha.sh"
OPTS_FILE="${OPTS_FILE:-addons/$ADDON/.options.json}"

[ -f "$OPTS_FILE" ] || { echo "ABORT: options file '$OPTS_FILE' not found. Copy the .options.example.json and fill it." >&2; exit 1; }

# Validate JSON locally before sending.
node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$OPTS_FILE" \
  || { echo "ABORT: '$OPTS_FILE' is not valid JSON." >&2; exit 1; }

echo "==> Pushing options to $SLUG"
# Wrap as {"options": <file>} and ship base64 over SSH to avoid quoting issues.
payload="$(node -e "const o=require('fs').readFileSync(process.argv[1],'utf8'); process.stdout.write(JSON.stringify({options: JSON.parse(o)}))" "$OPTS_FILE")"
b64="$(printf '%s' "$payload" | base64 | tr -d '\n')"
$HA ssh "echo $b64 | base64 -d | curl -fsS -X POST \
  -H \"Authorization: Bearer \$SUPERVISOR_TOKEN\" \
  -H 'Content-Type: application/json' \
  -d @- http://supervisor/addons/$SLUG/options" >/dev/null
echo "    options set"

echo "==> Restarting $SLUG"
$HA restart

echo "==> Waiting for the add-on to come up"
if $HA wait 120; then
  echo "==> Up. Recent logs:"
  $HA logs 20
else
  echo "==> Add-on did NOT reach 'started'. Recent logs:" >&2
  $HA logs 40
  exit 1
fi
