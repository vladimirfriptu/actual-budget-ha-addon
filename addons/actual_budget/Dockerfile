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

# Actual requires a secure context (HTTPS) for any non-localhost access, because
# it relies on SharedArrayBuffer behind cross-origin isolation. We serve its
# built-in HTTPS with a self-signed cert generated on first boot by run.sh, so
# we need openssl in the image. (Upstream is Debian-based, not Alpine.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# run.sh generates/persists the cert on /data, exports ACTUAL_HTTPS_* and execs
# the upstream `node app.js`. WORKDIR /app and EXPOSE 5006 are inherited; the
# upstream tini entrypoint runs this CMD. Actual still persists to /data.
COPY run.sh /run.sh
RUN chmod +x /run.sh
CMD ["/run.sh"]
