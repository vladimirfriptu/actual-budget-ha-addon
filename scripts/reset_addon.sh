#!/usr/bin/env bash
# Wipe an add-on's data and start it fresh, by uninstalling then reinstalling it.
# Uninstalling a HAOS add-on removes its /data (for actual_budget that is the
# whole Actual budget: server-files, user-files, the self-signed cert). The local
# add-on source under /addons/<slug> stays, so it rebuilds from the same code.
#
# DESTRUCTIVE. Requires CONFIRM=yes.
#
#   CONFIRM=yes ADDON=actual_budget bash scripts/reset_addon.sh   # nuke the budget
#   CONFIRM=yes ADDON=actual_capture bash scripts/reset_addon.sh  # clear capture cache
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ADDON="${ADDON:-actual_budget}"
export SLUG="${SLUG:-local_$ADDON}"
HA="bash $REPO_ROOT/scripts/ha.sh"

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "REFUSING: this wipes ALL data of add-on '$ADDON' ($SLUG)." >&2
  echo "Re-run with: CONFIRM=yes ADDON=$ADDON bash scripts/reset_addon.sh" >&2
  exit 2
fi

echo "==> Uninstalling $SLUG (this deletes its /data)"
$HA api POST "/addons/$SLUG/uninstall" >/dev/null || { echo "uninstall failed (already gone?)" >&2; }

echo "==> Reloading store"
$HA store-reload

echo "==> Reinstalling $SLUG (rebuilds the image, fresh /data)"
$HA api POST "/addons/$SLUG/install" >/dev/null

echo "==> Starting $SLUG"
$HA restart

echo "==> Waiting for the add-on to come up"
if $HA wait 240; then
  echo "==> Fresh. Recent logs:"
  $HA logs 20
  echo
  echo "NOTE: actual_budget reset also cleared the self-signed cert and server"
  echo "password — re-accept the cert and set a password again. A new budget gets"
  echo "a new Sync ID; update actual_capture's option and re-run 'just configure'."
else
  echo "==> Add-on did NOT reach 'started'. Recent logs:" >&2
  $HA logs 40
  exit 1
fi
