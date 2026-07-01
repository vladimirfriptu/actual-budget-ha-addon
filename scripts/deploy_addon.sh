#!/usr/bin/env bash
# Deploy a local HAOS add-on from this monorepo over SSH.
#
# Addon-generic: pick which add-on with ADDON (default actual_budget). The build
# context is the whole addons/<ADDON>/ directory (minus node_modules/dist). The
# Dockerfile is built on the box by Supervisor.
#
# Dev loop (no REF): Supervisor `rebuild` + `restart`.
# Versioned deploy (REF set): `store/reload` + `update` so Supervisor also
# registers the deployed version.
#
# Connection details live in scripts/ha.sh (HA_HOST / HA_PORT / HA_KEY / SLUG).
#
#   bash scripts/deploy_addon.sh                       # deploy actual_budget (working tree)
#   ADDON=actual_capture bash scripts/deploy_addon.sh  # deploy actual_capture
#   REF=v0.1.0 bash scripts/deploy_addon.sh            # deploy a committed git ref
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ADDON="${ADDON:-actual_budget}"
ADDON_DIR="addons/$ADDON"
REMOTE_DIR="/addons/$ADDON"
# Local add-ons are exposed by Supervisor under a local_ prefix.
export SLUG="${SLUG:-local_$ADDON}"
HA="bash $REPO_ROOT/scripts/ha.sh"
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

[ -f "$ADDON_DIR/config.yaml" ] || { echo "ABORT: $ADDON_DIR/config.yaml not found." >&2; exit 1; }

echo "==> Staging build context from $ADDON_DIR"
# rsync (not cpio) — cpio -p refuses to write through the /var->/private/var
# symlink that mktemp -d returns on macOS. Exclude build/deps artifacts.
rsync -a --exclude='node_modules' --exclude='dist' --exclude='*.tsbuildinfo' \
  --exclude='.env' --exclude='.options.json' \
  "$ADDON_DIR/" "$STAGE/"
echo "    staged files: $(find "$STAGE" -type f | wc -l | tr -d ' ')"

echo "==> Transferring to $REMOTE_DIR"
$HA ssh "rm -rf $REMOTE_DIR && mkdir -p $REMOTE_DIR"
# COPYFILE_DISABLE=1 stops macOS bsdtar from emitting AppleDouble ._* sidecar
# files (extended-attribute junk) into the add-on dir on the box.
COPYFILE_DISABLE=1 tar czf - -C "$STAGE" . | $HA ssh "tar xzf - -C $REMOTE_DIR"

# Make Supervisor pick up the on-box files (new version metadata, or a
# brand-new local add-on it has never seen).
echo "==> Reloading add-on store"
$HA store-reload

if [ -n "$REF" ]; then
  echo "==> Registering deployed version via Supervisor update"
  if $HA update; then
    echo "    updated — Supervisor now reports the deployed version"
  else
    echo "    update not applicable (rollback / same version) — rebuilding in place" >&2
    $HA rebuild
    $HA restart
  fi
else
  # First-ever deploy: the add-on is not installed yet, so `rebuild` 404s.
  # Install it; otherwise rebuild the existing image in place.
  state="$($HA state-raw 2>/dev/null || echo unknown)"
  if [ "$state" = "unknown" ] || [ -z "$state" ]; then
    echo "==> First install (pulls/builds the image — can take a few minutes)"
    $HA api POST "/addons/$SLUG/install" >/dev/null
  else
    echo "==> Rebuilding add-on image (this can take a few minutes on first build)"
    $HA rebuild
  fi
  # Supervisor `rebuild`/`install` does not start the container — always start.
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
