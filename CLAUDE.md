# Project guide for Claude (actual-budget-addon)

This file is loaded every session. Details live in the committed,
provider-agnostic doc: **`docs/ai/development-workflow.md`** (read it before
non-trivial work).

## What this is

A **local Home Assistant OS add-on** that wraps upstream
[Actual Budget](https://actualbudget.org) (`actualbudget/actual-server`) so the
owner can run a private personal-finance MVP on the existing HAOS box.

This is a **wrapper / packaging project — we ship NO application code of our
own.** The add-on Dockerfile is the upstream image plus one tweak (`USER root`);
everything else is the push-based deploy machinery reused from the sibling
`telegram-capture` (tg-catch) project.

## How we work here

- Developed end-to-end through Claude Code; Claude makes the technical decisions.
  Pull the human in only on blockers (ambiguous product requirements,
  irreversible actions, secrets).
- **AI docs language (project override):** specs/plans under `.claude/` and docs
  under `docs/ai/` are written in **English** (matches the sibling project).
  Conversation with the owner stays in Russian.

## Architecture (one line)

`addons/actual_budget/Dockerfile` = `FROM actualbudget/actual-server:latest` + `USER root`.
Actual's server listens on `:5006` over **HTTPS** (self-signed cert generated on
first boot by `addons/actual_budget/run.sh`, stored on `/data`), exposed as a direct LAN port.
HTTPS is mandatory: Actual needs a secure context for `SharedArrayBuffer`, so
plain `http://<lan-ip>` makes the SPA throw a `FatalError`. It persists
ALL state to `/data` (`server-files/account.sqlite`, `user-files/`), which
coincides with the HAOS add-on persistent volume — so persistence needs no
config. Auth is Actual's own server password, set in-UI on first run.

## Access model (MVP)

Direct LAN port over HTTPS: `https://192.168.68.140:5006` (accept the
self-signed cert once). **No Ingress** in the MVP — Actual
is an SPA that does not cope with the rotating `/api/hassio_ingress/<token>`
prefix (deferred; see the spec §5).

## Deploy = push-based flow (from the sibling project, simplified)

There is no app code, no frontend build, no test suite — so the pipeline is much
thinner than tg-catch's:

1. `just redeploy` — push `addons/actual_budget/` to HAOS over SSH → rebuild → restart → logs.
2. `just smoke` — assert the Actual UI answers HTTP 2xx/3xx on `:5006`.
3. `just ship "msg"` — commit (STAGED only) → push → deploy. **Only on an
   explicit go signal** ("коммить" / "go" / "задеплой"). Commit message in
   English, no `Co-Authored-By` trailer.

Deploy is push-based (code is tar'd over SSH; HAOS does not git pull).
SSH/Supervisor details are centralized in `scripts/ha.sh`.

## Gotchas (do not regress)

- **Supervisor `rebuild` does not start the container — always `restart` after**
  (already handled in `deploy_addon.sh`).
- The `/data` permission risk: upstream runs as the non-root `actual` user while
  Supervisor's `/data` is root-owned. We run `USER root` to avoid a first-boot
  write failure. On the first deploy, verify `server-files/account.sqlite`
  appears under the add-on's persistent `/data`.
- Actual's data survives `rebuild` because its default `/data` IS the HAOS
  persistent volume — same gotcha class as the sibling's SQLite-on-`/data`.
- Image tag: MVP runs `:latest`. **Pin a concrete tag before declaring the
  add-on "kept"** (spec §8 / §11) for reproducible rebuilds.

## Deferred (not in the MVP)

Ingress (sidebar), Ghostfolio/investments, automated off-box backups, family
multi-user, image-tag pinning + release/rollback discipline. See the spec §10.
