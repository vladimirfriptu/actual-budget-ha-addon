#!/usr/bin/env sh
# Bring Actual up over HTTPS.
#
# Why HTTPS is mandatory: Actual enables cross-origin isolation (COOP/COEP) to
# use SharedArrayBuffer. Browsers only honour those headers — and only grant a
# "secure context" — over HTTPS or localhost. Over plain http://<lan-ip> the
# isolation is dropped, SharedArrayBuffer is unavailable, and the SPA dies with
# a FatalError. A self-signed cert is enough: once the user accepts the cert
# warning, the origin is a secure context and Actual works.
#
# The cert lives on the add-on's persistent /data so it survives rebuilds and
# is generated only once.
set -e

CERT_DIR=/data/certs
KEY="$CERT_DIR/selfsigned.key"
CRT="$CERT_DIR/selfsigned.crt"

# HAOS host IP (matches scripts/ha.sh). Baked into the cert SAN so the address
# bar host matches; the cert is self-signed either way, so the browser still
# shows a one-time "accept" prompt.
HOST_IP="${ACTUAL_HOST_IP:-192.168.68.140}"

if [ ! -f "$KEY" ] || [ ! -f "$CRT" ]; then
  echo "==> Generating self-signed certificate in $CERT_DIR (first run)"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$KEY" -out "$CRT" -days 3650 \
    -subj "/CN=actual-budget-addon" \
    -addext "subjectAltName=IP:${HOST_IP},DNS:localhost"
fi

export ACTUAL_HTTPS_KEY="$KEY"
export ACTUAL_HTTPS_CERT="$CRT"

# Hand off to the upstream start command (WORKDIR /app, `node app.js`).
cd /app
exec node app.js
