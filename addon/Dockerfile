# Local HAOS add-on: wrap upstream Actual Budget unchanged.
#
# We ship no application code of our own — this image is the upstream
# actualbudget/actual-server with one tweak (USER root, see below). The build
# context is assembled by scripts/deploy_addon.sh (just this Dockerfile +
# config.yaml).
#
# Tag pinning (spec §8 / §11): start on :latest for the trial; pin a concrete
# tag (e.g. actualbudget/actual-server:25.x) before declaring the add-on "kept".
FROM actualbudget/actual-server:latest

# Mitigate the /data permission risk (spec §8): the upstream image runs as the
# non-root `actual` user, while the Supervisor-mounted /data is root-owned.
# Running as root is acceptable for a single-owner LAN add-on and avoids a
# first-boot write failure. (Revisit if we want least-privilege later.)
USER root

# Upstream entrypoint (tini -> node app.js), WORKDIR /app and EXPOSE 5006 are
# inherited. Actual persists to /data by default, which coincides with the HAOS
# add-on persistent volume — so persistence works with no extra config and no
# CMD override.
