# actual-budget-addon — monorepo task commands
#
# Two HAOS add-ons live here: actual_budget (wrapper around upstream Actual) and
# actual_capture (Telegram+AI capture service). Deploy is push-based (code is
# tar'd over SSH; HAOS does not git pull). Most recipes take an `addon` arg that
# defaults to actual_budget.

# List available recipes
default:
    @just --list

# ─── Deploy ────────────────────────────────────────────────────────

# Push an add-on to HAOS, rebuild + restart (no git). e.g. just redeploy actual_capture
redeploy addon="actual_budget":
    ADDON={{addon}} bash scripts/deploy_addon.sh

# Commit (STAGED only) → push → deploy. Stage first (git add <paths>).
# Usage: just ship "msg" [addon]
ship msg addon="actual_budget":
    if git diff --cached --quiet; then echo "Nothing staged — run 'git add <paths>' first." >&2; exit 1; fi
    git commit -m "{{msg}}"
    git push
    ADDON={{addon}} bash scripts/deploy_addon.sh

# Redeploy a previously committed git tag (no new commit/tag).
rollback version addon="actual_budget":
    REF=v{{version}} ADDON={{addon}} bash scripts/deploy_addon.sh

# ─── Add-on lifecycle / diagnostics ────────────────────────────────

# Tail add-on logs (default 40 lines): just ha-logs actual_capture 80
ha-logs addon="actual_budget" n="40":
    SLUG=local_{{addon}} bash scripts/ha.sh logs {{n}}

# Restart / stop the add-on; show state.
ha-restart addon="actual_budget":
    SLUG=local_{{addon}} bash scripts/ha.sh restart
ha-stop addon="actual_budget":
    SLUG=local_{{addon}} bash scripts/ha.sh stop
ha-state addon="actual_budget":
    SLUG=local_{{addon}} bash scripts/ha.sh state

# Push add-on options from addons/<addon>/.options.json and restart it.
configure addon="actual_capture":
    ADDON={{addon}} bash scripts/configure_addon.sh

# DESTRUCTIVE: wipe an add-on's data and start fresh (uninstall + reinstall).
# Usage: CONFIRM=yes just reset actual_budget
reset addon="actual_budget":
    ADDON={{addon}} bash scripts/reset_addon.sh

# Smoke test the Actual web UI over HTTPS (self-signed → -k). actual_budget only.
smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    host="${HA_HOST:-192.168.68.140}"
    code="$(curl -fsSk -o /dev/null -w '%{http_code}' "https://$host:5006/" || true)"
    case "$code" in
      2*|3*) echo "OK — Actual answered HTTP $code on https://$host:5006/" ;;
      *)     echo "FAIL — got HTTP '${code:-no-response}' from https://$host:5006/" >&2; exit 1 ;;
    esac

# ─── actual_capture (Node service) local checks ────────────────────

# Install capture deps.
cap-install:
    npm --prefix addons/actual_capture ci

# Typecheck (build) + unit tests for the capture service (the deploy gate).
cap-test:
    npm --prefix addons/actual_capture run build
    npm --prefix addons/actual_capture test

# Run the capture service locally (needs addons/actual_capture/.env).
cap-serve:
    npm --prefix addons/actual_capture run dev

# One-off: seed Actual with current state from addons/actual_capture/seed.yaml
# (idempotent). Needs ACTUAL_* in addons/actual_capture/.env.
cap-seed:
    npm --prefix addons/actual_capture run seed
