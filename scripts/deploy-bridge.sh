#!/usr/bin/env bash
# Zero-downtime bridge_v2 deployment.
#
# Builds the binary, copies it to the volume mount, and sends SIGHUP.
# tableflip re-execs the new binary; old sessions drain on the old code,
# new connections get the new code.
#
# Usage: ./scripts/deploy-bridge.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$ROOT_DIR/volumes/bridge_v2_bin"
CONTAINER="neohabitat-bridge_v2-1"

echo "==> Building bridge_v2 (linux/amd64, static)..."
cd "$ROOT_DIR/bridge_v2"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -trimpath \
    -ldflags="-s -w -X main.buildVersion=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
    -o "$BIN_DIR/bridge_v2" \
    .

echo "==> Binary ready at $BIN_DIR/bridge_v2"
ls -la "$BIN_DIR/bridge_v2"

echo "==> Sending SIGHUP to $CONTAINER..."
docker exec "$CONTAINER" kill -HUP 1

echo "==> Done. Old sessions draining, new connections use $(git rev-parse --short HEAD 2>/dev/null || echo 'new binary')."
