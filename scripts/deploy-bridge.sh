#!/usr/bin/env bash
# Zero-downtime bridge_v2 deployment.
#
# Modes:
#   ./scripts/deploy-bridge.sh                     # Same-host: build + SIGHUP
#   ./scripts/deploy-bridge.sh --migrate HOST      # Cross-host: CRIU checkpoint → transfer → restore
#   ./scripts/deploy-bridge.sh --rolling HOST      # Rolling: start new on target, drain old
#
# All modes preserve active C64 sessions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$ROOT_DIR/volumes/bridge_v2_bin"
CONTAINER="neohabitat-bridge_v2-1"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
CHECKPOINT_DIR="/var/lib/docker/containers"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}==> WARNING:${NC} $*"; }
err()  { echo -e "${RED}==> ERROR:${NC} $*" >&2; }

build_binary() {
    log "Building bridge_v2 (linux/amd64, static)..."
    cd "$ROOT_DIR/bridge_v2"
    local version
    version=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
        -trimpath \
        -ldflags="-s -w -X main.buildVersion=$version" \
        -o "$BIN_DIR/bridge_v2" \
        .
    log "Binary ready: $version ($(du -h "$BIN_DIR/bridge_v2" | cut -f1))"
}

health_check() {
    local host="${1:-localhost}"
    local port="${2:-2026}"
    local retries=10
    local i=0
    while [ $i -lt $retries ]; do
        if nc -z -w 2 "$host" "$port" 2>/dev/null; then
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    return 1
}

get_container_id() {
    docker inspect --format='{{.Id}}' "$CONTAINER" 2>/dev/null
}

get_session_count() {
    docker logs --since 5s "$CONTAINER" 2>&1 | grep -c 'session_id' || echo "0"
}

# ── Same-host upgrade via tableflip ──────────────────────────────────
cmd_upgrade() {
    log "Same-host zero-downtime upgrade"
    build_binary

    if ! docker exec "$CONTAINER" true 2>/dev/null; then
        err "Container $CONTAINER not running"
        exit 1
    fi

    log "Sending SIGHUP to $CONTAINER..."
    docker exec "$CONTAINER" kill -HUP 1

    log "Waiting for new process to be ready..."
    sleep 2
    if health_check; then
        log "Upgrade complete. Old sessions draining, new connections on new binary."
    else
        warn "Health check failed — check container logs"
    fi
}

# ── Cross-host migration via CRIU ────────────────────────────────────
cmd_migrate() {
    local target="$1"
    local checkpoint_name="migr-$(date +%s)"

    log "Live migration to $target"

    # Verify CRIU is available
    if ! command -v criu &>/dev/null; then
        err "CRIU not installed on source host. Install with: apt install criu"
        exit 1
    fi

    # Verify target is reachable
    if ! ssh -o ConnectTimeout=5 "$target" true 2>/dev/null; then
        err "Cannot reach $target via SSH"
        exit 1
    fi

    local container_id
    container_id=$(get_container_id)
    if [ -z "$container_id" ]; then
        err "Container $CONTAINER not found"
        exit 1
    fi

    log "Checkpointing container (sessions preserved)..."
    docker checkpoint create --leave-running "$CONTAINER" "$checkpoint_name"

    local checkpoint_path="$CHECKPOINT_DIR/$container_id/checkpoints/$checkpoint_name"
    log "Checkpoint at: $checkpoint_path"

    log "Transferring checkpoint to $target..."
    ssh "$target" "mkdir -p /tmp/bridge-migrate"
    tar -C "$checkpoint_path" -cf - . | ssh "$target" "tar -C /tmp/bridge-migrate -xf -"

    log "Ensuring target has the compose stack..."
    ssh "$target" "cd /opt/neohabitat && docker compose $COMPOSE_FILES up -d --no-start bridge_v2 2>/dev/null" || true

    local remote_container_id
    remote_container_id=$(ssh "$target" "docker inspect --format='{{.Id}}' $CONTAINER 2>/dev/null") || true

    if [ -n "$remote_container_id" ]; then
        local remote_checkpoint_path="$CHECKPOINT_DIR/$remote_container_id/checkpoints/$checkpoint_name"
        ssh "$target" "mkdir -p $remote_checkpoint_path && cp -a /tmp/bridge-migrate/* $remote_checkpoint_path/"

        log "Restoring on $target..."
        ssh "$target" "docker start --checkpoint $checkpoint_name $CONTAINER"

        log "Verifying health on target..."
        if ssh "$target" "nc -z -w 5 localhost 2026"; then
            log "Migration successful! Stopping source container..."
            docker stop "$CONTAINER"
            log "Done. bridge_v2 is now running on $target with all sessions intact."
        else
            warn "Health check failed on target — source container still running"
        fi
    else
        err "Could not find bridge_v2 container on target"
        warn "Source container still running"
    fi

    # Cleanup
    ssh "$target" "rm -rf /tmp/bridge-migrate" 2>/dev/null || true
}

# ── Rolling upgrade (new image, drain old) ───────────────────────────
cmd_rolling() {
    local target="$1"

    log "Rolling upgrade to $target"
    build_binary

    log "Copying binary to $target..."
    scp "$BIN_DIR/bridge_v2" "$target:/opt/neohabitat/volumes/bridge_v2_bin/bridge_v2"

    log "Starting new bridge on $target..."
    ssh "$target" "cd /opt/neohabitat && docker compose $COMPOSE_FILES up -d bridge_v2"

    log "Waiting for new bridge to be healthy..."
    if ssh "$target" "for i in \$(seq 10); do nc -z -w 2 localhost 2026 && exit 0; sleep 1; done; exit 1"; then
        log "New bridge healthy on $target."
        log "Draining old bridge on source..."
        # Stop accepting new connections on source (close listener)
        docker exec "$CONTAINER" kill -HUP 1 2>/dev/null || true
        log "Source bridge draining. It will exit when all sessions close."
        log "Monitor with: docker logs -f $CONTAINER 2>&1 | grep 'drain\\|session'"
    else
        err "New bridge failed health check on $target"
    fi
}

# ── Main ─────────────────────────────────────────────────────────────
usage() {
    echo "Usage: $0 [--migrate HOST | --rolling HOST]"
    echo ""
    echo "  (no args)        Same-host upgrade: build binary + SIGHUP"
    echo "  --migrate HOST   CRIU live migration to HOST (preserves TCP connections)"
    echo "  --rolling HOST   Rolling deploy: start on HOST, drain source"
}

case "${1:-}" in
    --migrate)
        [ -z "${2:-}" ] && { usage; exit 1; }
        cmd_migrate "$2"
        ;;
    --rolling)
        [ -z "${2:-}" ] && { usage; exit 1; }
        cmd_rolling "$2"
        ;;
    --help|-h)
        usage
        ;;
    "")
        cmd_upgrade
        ;;
    *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
esac
