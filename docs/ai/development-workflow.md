# Development workflow (actual-budget-addon)

Provider-agnostic reference for working on this repo. Committed to git.

## What this repo is

A **wrapper / packaging** Home Assistant OS add-on for upstream
[Actual Budget](https://actualbudget.org). We ship no application code: the
add-on image is `actualbudget/actual-server` with one tweak (`USER root`). All
the moving parts are the push-based deploy machinery, adapted from the sibling
`telegram-capture` project.

## Layout

```
addon/
  config.yaml         # add-on manifest (slug, port 5006, no options, no ingress)
  Dockerfile          # FROM actualbudget/actual-server:latest + USER root
scripts/
  ha.sh               # SSH + Supervisor REST API wrapper (connection details)
  deploy_addon.sh     # stage addon/ → tar over SSH → rebuild + restart
Justfile              # redeploy / ship / rollback / smoke / ha-* lifecycle
docs/ai/              # this doc (committed, provider-agnostic)
.claude/specs/        # design spec (gitignored, not committed)
```

## How Actual runs in the add-on

- Upstream entrypoint `tini -g -- node app.js`, WORKDIR `/app`, EXPOSE `5006`.
- Persists to **`/data`** by default: `server-files/account.sqlite`,
  `user-files/`, `.migrate`. No env needed.
- Because Actual's default `/data` coincides with the HAOS add-on persistent
  volume, data survives rebuild/restart with zero config.
- Auth is Actual's own **server password**, set in the UI on first run. There
  are no add-on options in the MVP.

## Access model

Direct LAN port `5006` over **HTTPS** (`https://<haos-ip>:5006`). HTTPS is
mandatory: Actual uses `SharedArrayBuffer` behind cross-origin isolation
(COOP/COEP), which browsers only honour in a secure context (HTTPS or
localhost); over plain HTTP the SPA throws a `FatalError`. `addon/run.sh`
generates a self-signed cert on first boot (stored on `/data/certs`, so it
survives rebuilds) and points `ACTUAL_HTTPS_KEY` / `ACTUAL_HTTPS_CERT` at it.
The browser shows a one-time self-signed-cert warning that the user accepts.

No Ingress in the MVP — Actual is an SPA that does not handle HA's rotating
`/api/hassio_ingress/<token>/` prefix. See the spec §5 for the shape of the
future Ingress work.

## Deploy

Push-based over SSH (HAOS does not git pull). `scripts/deploy_addon.sh` stages
just the add-on files (`config.yaml` + `Dockerfile`), tars them to
`/addons/actual_budget`, then rebuilds + restarts via the Supervisor API.
`scripts/ha.sh` centralizes connection details (override with
`HA_HOST` / `HA_PORT` / `HA_KEY` / `SLUG`). The installed add-on slug is
`local_actual_budget`.

- Dev loop (no `REF`): Supervisor `rebuild` + `restart`.
- Reproducible deploy (`REF=v0.1.0`): `store/reload` + `update` so Supervisor
  registers the deployed version; falls back to `rebuild` + `restart`.

**Gotcha:** Supervisor `rebuild` does NOT start the container — always `restart`
after. Handled in `deploy_addon.sh`.

First-time bring-up:
1. Ensure the HAOS box can reach Docker Hub (the first build pulls the upstream
   image).
2. `just redeploy` — Supervisor builds the Dockerfile, then restarts.
3. `just smoke` — confirm the UI answers on `:5006`.
4. Open `https://<haos-ip>:5006`, accept the self-signed cert warning, set the
   Actual server password, and switch the language to Ukrainian
   (Settings → Language → Українська).

## Image tag policy

The MVP runs `actualbudget/actual-server:latest`. Before declaring the add-on
"kept", pin a concrete tag (e.g. `:25.x`) in `addon/Dockerfile` so rebuilds are
reproducible (spec §8 / §11).

## Verification / acceptance

Acceptance for the trial (spec §9): can add accounts, categories, a
"Будівництво" construction category group, and daily transactions; reports show
where money went; data persists across an add-on restart; UI usable in
Ukrainian. There is no automated test suite — `just smoke` is the only
mechanical check.

## Backups (MVP)

No automated off-box backup. Rely on `/data` persistence plus Actual's built-in
budget **export** (Settings → Export) done manually. Automate later if Actual is
kept (spec §10).
