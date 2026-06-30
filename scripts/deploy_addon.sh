#!/usr/bin/env bash
# Deploy the actual_budget local HAOS add-on over SSH.
#
# This is a wrapper/packaging add-on: there is NO application code of our own.
# The build context is just the add-on files (config.yaml + Dockerfile, and the
# optional icon/logo). The Dockerfile pulls upstream actualbudget/actual-server
# and Supervisor builds it on the box.
#
# Dev loop (no REF): Supervisor `rebuild` + `restart`.
# Versioned deploy (REF set): `store/reload` + `update` so Supervisor also
# registers the deployed version.
#
# Connection details live in scripts/ha.sh (HA_HOST / HA_PORT / HA_KEY / SLUG).
#
#   bash scripts/deploy_addon.sh            # deploy the current working tree
#   REF=v0.1.0 bash scripts/deploy_addon.sh # deploy a committed git ref (release / rollback)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
HA="bash $REPO_ROOT/scripts/ha.sh"
REMOTE_DIR="/addons/actual_budget"
REF="${REF:-}"

STAGE="$(mktemp -d)"
SRC=""
cleanup() { rm -rf "$STAGE" "$SRC"; }
trap cleanup EXIT

# Pick the source tree: a git ref (clean, reproducible) or the working tree.
if [ -n "$REF" ]; then
  echo "==> Source: git ref '$REF' (reproducible deploy)"
  git rev-parse --verify "$REF^{commit}" >/dev/null 2>&1 || { echo "ABORT: unknown git ref '$REF'." >&2; exit 1; }
  SRC="$(mktemp -d)"
  git -C "$REPO_ROOT" archive "$REF" | tar -x -C "$SRC"
  BUILD_ROOT="$SRC"
else
  echo "==> Source: current working tree"
  BUILD_ROOT="$REPO_ROOT"
fi
cd "$BUILD_ROOT"

echo "==> Staging build context"
cp addon/config.yaml addon/Dockerfile "$STAGE/"
# Optional cosmetic assets — copied only if present (none in the MVP).
cp addon/icon.png addon/logo.png "$STAGE/" 2>/dev/null || true
echo "    staged files: $(find "$STAGE" -type f | wc -l | tr -d ' ')"

echo "==> Transferring to $REMOTE_DIR"
$HA ssh "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"
tar czf - -C "$STAGE" . | $HA ssh "tar xzf - -C $REMOTE_DIR"

if [ -n "$REF" ]; then
  echo "==> Reloading add-on store (refresh version metadata)"
  $HA store-reload
  echo "==> Registering deployed version via Supervisor update"
  if $HA update; then
    echo "    updated — Supervisor now reports the deployed version"
  else
    echo "    update not applicable (rollback / same version) — rebuilding in place" >&2
    $HA rebuild
    $HA restart
  fi
else
  echo "==> Rebuilding add-on image (this can take a few minutes on first build)"
  $HA rebuild
  # Supervisor `rebuild` does not start the container — always `restart` after.
  echo "==> Starting add-on"
  $HA restart
fi

echo "==> Waiting for the add-on to come up"
if $HA wait 240; then
  echo "==> Up. Recent logs:"
  $HA logs 20
else
  echo "==> Add-on did NOT reach 'started'. Recent logs:" >&2
  $HA logs 40
  exit 1
fi
