#!/usr/bin/env bash
# Thin wrapper around SSH + the HA Supervisor REST API for the actual_budget
# add-on. Centralizes connection details so deploy_addon.sh and the Justfile
# share one path.
#
# Override via env: HA_HOST, HA_PORT, HA_KEY, SLUG.
#
# Usage:
#   scripts/ha.sh ssh '<remote command>'   # run a command on the HAOS host
#   scripts/ha.sh api GET /addons/.../info # raw Supervisor API call
#   scripts/ha.sh logs [N]                 # tail N (default 40) add-on log lines
#   scripts/ha.sh state                    # state + version of the add-on
#   scripts/ha.sh rebuild                  # rebuild the local add-on image
#   scripts/ha.sh restart | start | stop   # lifecycle controls
set -euo pipefail

HA_HOST="${HA_HOST:-192.168.68.140}"
HA_PORT="${HA_PORT:-22}"
HA_KEY="${HA_KEY:-$HOME/.config/ha-deploy/id_ed25519}"
SLUG="${SLUG:-local_actual_budget}"

ha_ssh() {
  ssh -i "$HA_KEY" -p "$HA_PORT" -o BatchMode=yes -o ConnectTimeout=8 root@"$HA_HOST" "$@"
}

api() {
  local method="$1" path="$2"
  ha_ssh "curl -fsS -X $method -H \"Authorization: Bearer \$SUPERVISOR_TOKEN\" http://supervisor$path"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  ssh)
    ha_ssh "$@"
    ;;
  api)
    method="$1"; path="$2"
    api "$method" "$path"
    ;;
  logs)
    n="${1:-40}"
    api GET "/addons/$SLUG/logs" | tail -n "$n"
    ;;
  state)
    api GET "/addons/$SLUG/info" | jq '.data | {state, version, version_latest}'
    ;;
  state-raw)
    api GET "/addons/$SLUG/info" | jq -r .data.state
    ;;
  wait)
    timeout="${1:-150}"
    elapsed=0
    s=""
    while [ "$elapsed" -lt "$timeout" ]; do
      s="$(api GET "/addons/$SLUG/info" | jq -r .data.state)"
      case "$s" in
        started) echo "started after ${elapsed}s"; exit 0 ;;
        error)   echo "ERROR state after ${elapsed}s" >&2; exit 1 ;;
      esac
      sleep 4
      elapsed=$((elapsed + 4))
    done
    echo "timed out after ${timeout}s (last state: ${s:-unknown})" >&2
    exit 1
    ;;
  rebuild)
    api POST "/addons/$SLUG/rebuild" | jq -r .result
    ;;
  store-reload)
    api POST "/store/reload" >/dev/null && echo reloaded
    ;;
  update)
    # Supervisor transiently 400s an update until the store cache refreshes, so
    # reload the store and retry a few times. Use a non -f curl to keep the body
    # (api() uses `curl -f`, which would abort on the transient 400).
    out=""
    for _ in 1 2 3 4 5; do
      ha_ssh "curl -fsS -X POST -H \"Authorization: Bearer \$SUPERVISOR_TOKEN\" http://supervisor/store/reload" >/dev/null 2>&1 || true
      out="$(ha_ssh "curl -sS -X POST -H \"Authorization: Bearer \$SUPERVISOR_TOKEN\" http://supervisor/addons/$SLUG/update" 2>/dev/null || true)"
      case "$out" in
        *'"result":"ok"'*) echo ok; exit 0 ;;
      esac
      sleep 3
    done
    echo "update failed after retries: ${out:-no response}" >&2
    exit 1
    ;;
  restart)
    api POST "/addons/$SLUG/restart" | jq -r .result
    ;;
  start)
    api POST "/addons/$SLUG/start" | jq -r .result
    ;;
  stop)
    api POST "/addons/$SLUG/stop" | jq -r .result
    ;;
  *)
    echo "usage: ha.sh {ssh|api|logs|state|rebuild|store-reload|update|restart|start|stop} ..." >&2
    exit 2
    ;;
esac
