#!/bin/bash
# Habitat development environment:
#   - Full Neohabitat stack via docker-compose
#   - bridge_v2 with Air hot-reload (source mounted, auto-rebuilds on .go changes)
#   - VICE C64 emulator connecting to bridge_v2
#
# Usage:
#   ./dev.sh              # Start stack + VICE
#   ./dev.sh --no-vice    # Start stack only (tail bridge logs)
#   ./dev.sh --down       # Tear down stack

set -e
cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

if [ "$1" = "--down" ]; then
    $COMPOSE down
    exit 0
fi

# Start the stack (rebuild bridge_v2 dev image if needed)
$COMPOSE up -d --build bridge_v2
$COMPOSE up -d

# Wait for bridge to be ready
echo "Waiting for bridge_v2 on port 2026..."
until nc -z localhost 2026 2>/dev/null; do sleep 1; done
echo "Bridge ready."

if [ "$1" = "--no-vice" ]; then
    echo "Tailing bridge_v2 logs (Ctrl+C to stop)..."
    $COMPOSE logs -f bridge_v2
else
    # Launch VICE in background, tail bridge logs
    echo "Starting VICE..."
    ./tools/vice/launch-vice.sh --bridge 127.0.0.1:2026 &
    VICE_PID=$!

    echo "Tailing bridge_v2 logs (Ctrl+C to stop, VICE running in background)..."
    $COMPOSE logs -f bridge_v2 || true

    # If logs tail exits, wait for VICE
    wait $VICE_PID 2>/dev/null || true
fi
