#!/usr/bin/env bash
# Start SearXNG container
# Usage: ./scripts/searxng.sh [start|stop|restart|status]
#
# also provide a config file, enable only json access and set access key

set -euo pipefail

CONTAINER_NAME="searxng"
IMAGE="docker.io/searxng/searxng:latest"
HOST_PORT="${SEARXNG_PORT:-8888}"
COMPOSE_NETWORK="${COMPOSE_NETWORK:-agentic-chatbot_internal}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/../../searxng"

action="${1:-start}"

stop_container() {
    if docker inspect "$CONTAINER_NAME" &>/dev/null; then
        echo "Stopping $CONTAINER_NAME..."
        docker stop "$CONTAINER_NAME" 2>/dev/null || true
        docker rm "$CONTAINER_NAME" 2>/dev/null || true
    fi
}

start_container() {
    # Create config/data dirs if missing
    mkdir -p "$DATA_DIR/config" "$DATA_DIR/data"

    # Stop existing container if running
    stop_container

    echo "Starting $CONTAINER_NAME on 127.0.0.1:${HOST_PORT}..."

    local env_args=()
    if [[ -n "${SEARXNG_SECRET:-}" ]]; then
        env_args+=(-e "SEARXNG_SECRET=${SEARXNG_SECRET}")
    fi

    docker run --name "$CONTAINER_NAME" -d \
        -p "127.0.0.1:${HOST_PORT}:8080" \
        -v "$DATA_DIR/config/:/etc/searxng/" \
        -v "$DATA_DIR/data/:/var/cache/searxng/" \
        "${env_args[@]+"${env_args[@]}"}" \
        --restart unless-stopped \
        "$IMAGE"

    # Join the agentic-chatbot compose network so mcp-web can reach us as http://searxng:8080
    if docker network inspect "$COMPOSE_NETWORK" &>/dev/null; then
        docker network connect "$COMPOSE_NETWORK" "$CONTAINER_NAME" 2>/dev/null || true
        echo "Joined network $COMPOSE_NETWORK"
    else
        echo "Warning: network $COMPOSE_NETWORK not found. Start docker compose first, then restart searxng."
    fi

    echo "$CONTAINER_NAME started. Test: curl 'http://localhost:${HOST_PORT}/search?q=test&format=json'"
}

case "$action" in
    start)
        start_container
        ;;
    stop)
        stop_container
        echo "$CONTAINER_NAME stopped."
        ;;
    restart)
        start_container
        ;;
    status)
        if docker inspect "$CONTAINER_NAME" &>/dev/null; then
            docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        else
            echo "$CONTAINER_NAME is not running."
        fi
        ;;
    *)
        echo "Usage: $0 [start|stop|restart|status]"
        exit 1
        ;;
esac
