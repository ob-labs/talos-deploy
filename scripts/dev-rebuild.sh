#!/bin/bash
set -euo pipefail

# Rebuild a single component and redeploy to k3d
# Usage: ./scripts/dev-rebuild.sh portal|sandbox-manager|workspace

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLUSTER="talos-local"

component="${1:-}"

case "$component" in
  portal)
    IMAGE="localhost:32000/talos-portal:latest"
    BUILD_DIR="$PROJECT_DIR/server"
    DEPLOY="talos-portal"
    ;;
  sandbox-manager)
    IMAGE="localhost:32000/sandbox-manager:latest"
    BUILD_DIR="$PROJECT_DIR/sandbox-manager"
    DEPLOY="sandbox-manager"
    ;;
  workspace)
    IMAGE="localhost:32000/claude-workspace:latest"
    BUILD_DIR="$PROJECT_DIR/images/workspace"
    DEPLOY=""
    ;;
  *)
    echo "Usage: $0 portal|sandbox-manager|workspace"
    exit 1
    ;;
esac

echo "=== Building $component ==="
docker build -t "$IMAGE" "$BUILD_DIR"
docker push "$IMAGE"

if [ -n "$DEPLOY" ]; then
  echo "=== Restarting deployment/$DEPLOY ==="
  kubectl rollout restart deployment/"$DEPLOY" -n system
  kubectl rollout status deployment/"$DEPLOY" -n system --timeout=60s
fi

echo "=== Done ==="
