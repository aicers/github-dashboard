#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="$(dirname "$0")"
CERT_FILE="$CERT_DIR/local.crt"
KEY_FILE="$CERT_DIR/local.key"

if command -v mkcert >/dev/null 2>&1; then
  mkcert -key-file "$KEY_FILE" -cert-file "$CERT_FILE" localhost
else
  openssl req \
    -x509 \
    -nodes \
    -days 365 \
    -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" >/dev/null 2>&1
fi

echo "Generated certificate at $CERT_FILE"
echo "Generated key at $KEY_FILE"
