# actual-budget-addon — task commands
#
# Wrapper/packaging add-on: no app code, no build, no test suite. The whole job
# is shipping the add-on (Dockerfile + config.yaml) to HAOS and managing its
# lifecycle. Deploy is push-based (code is tar'd over SSH; HAOS does not git pull).

# List available recipes
default:
    @just --list

# ─── Deploy pipeline (HAOS add-on) ─────────────────────────────────

# Fast iteration: push add-on files to HAOS, rebuild + restart (no git).
redeploy:
    bash scripts/deploy_addon.sh

# Full pipeline: commit (STAGED changes only) → push → deploy.
# Stage what you want first (git add <paths>). Usage: just ship "commit message"
ship msg:
    if git diff --cached --quiet; then echo "Nothing staged — run 'git add <paths>' first." >&2; exit 1; fi
    git commit -m "{{msg}}"
    git push
    bash scripts/deploy_addon.sh

# Redeploy a previously committed git tag (no new commit/tag).
rollback version:
    REF=v{{version}} bash scripts/deploy_addon.sh

# ─── Add-on lifecycle / diagnostics ────────────────────────────────

# Tail add-on logs (default 40 lines): just ha-logs 80
ha-logs n="40":
    bash scripts/ha.sh logs {{n}}

# Restart / stop the add-on; show state.
ha-restart:
    bash scripts/ha.sh restart
ha-stop:
    bash scripts/ha.sh stop
ha-state:
    bash scripts/ha.sh state

# Smoke test: assert the Actual web UI answers on the LAN port over HTTPS
# (2xx/3xx). -k because the cert is self-signed. Override host with HA_HOST.
smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    host="${HA_HOST:-192.168.68.140}"
    code="$(curl -fsSk -o /dev/null -w '%{http_code}' "https://$host:5006/" || true)"
    case "$code" in
      2*|3*) echo "OK — Actual answered HTTP $code on https://$host:5006/" ;;
      *)     echo "FAIL — got HTTP '${code:-no-response}' from https://$host:5006/" >&2; exit 1 ;;
    esac
