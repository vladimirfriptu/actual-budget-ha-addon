# actual-budget-addon

A local **Home Assistant OS add-on** that packages
[Actual Budget](https://actualbudget.org) — open-source envelope budgeting with
a modern UI and a Ukrainian locale — so you can run a private personal-finance
instance on your existing HAOS box.

This is a **wrapper**: it ships no application code of its own. The add-on image
is the upstream `actualbudget/actual-server` with a single tweak so it can write
to the add-on's persistent volume. Data lives on `/data` and survives
rebuilds/restarts.

## Access

The web UI is published on the LAN at **`http://<haos-ip>:5006`**
(e.g. `http://192.168.68.140:5006`). Auth is Actual's own **server password**,
which you set in the UI on first run. There is no Home Assistant sidebar
(Ingress) integration in this MVP — Actual is a single-page app that does not
cope with HA's rotating ingress URL prefix.

## First run

1. Make sure the HAOS box can reach Docker Hub (the first build pulls the
   upstream image).
2. From this repo: `just redeploy` — pushes the add-on to HAOS over SSH, builds
   the image, and starts it.
3. `just smoke` — checks that the UI answers on port 5006.
4. Open `http://<haos-ip>:5006`, set a server password, then switch the language
   to Ukrainian in **Settings → Language → Українська**. Expect ~20% of rarer
   screens to fall back to English.

## Usage notes

- **Construction project tracking:** model the renovation as a dedicated
  **category group** (e.g. "Будівництво") with subcategories (materials, work,
  …). Actual's reports can filter by category group, giving the
  "construction as a separate slice" view. No add-on feature needed.
- **Backups (MVP):** there is no automated off-box backup. Rely on `/data`
  persistence and Actual's built-in budget **export** (Settings → Export) done
  manually.

## Deploy (HAOS add-on)

Push-based flow — code is tar'd to HAOS over SSH; the box does not git pull.

```sh
just redeploy           # push add-on files, rebuild + restart, tail logs
just smoke              # assert the UI answers on :5006
just ship "message"     # commit (staged) → push → deploy
just rollback 0.1.0     # redeploy a prior git tag
just ha-logs 80         # tail add-on logs
just ha-state           # show add-on state / version
```

Connection details (host, SSH key, slug) live in `scripts/ha.sh` and can be
overridden via `.env` / environment variables (see `.env.example`). The
installed add-on slug is `local_actual_budget`.

## Status

MVP / trial. Deferred: HA Ingress (sidebar), Ghostfolio investments tracking,
automated backups, family multi-user, and pinning the upstream image tag for
reproducible rebuilds.
