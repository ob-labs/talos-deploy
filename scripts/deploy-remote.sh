#!/bin/bash
set -euo pipefail

# Deploy on ECS — apply manifests and restart deployments to pull latest images.
#
# Usage:
#   npm run ecs:deploy              # apply + restart
#   npm run ecs:deploy -- --apply   # first-time apply only
#   npm run ecs:deploy -- --restart # restart only (pull latest images)
#
# Prerequisites:
#   - k3s installed (npm run ecs:init)
#   - Repo cloned to /opt/talos-deploy

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
export KUBECONFIG

# Use k3s kubectl if standalone kubectl is not available
if command -v kubectl &>/dev/null; then
  KUBECTL=kubectl
elif command -v k3s &>/dev/null; then
  KUBECTL="k3s kubectl"
else
  echo "ERROR: neither kubectl nor k3s found"
  exit 1
fi

# Load registry config from .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

REGISTRY="${REGISTRY:?请设置 REGISTRY (镜像仓库地址)}"
OVERLAY_DIR="$PROJECT_DIR/infra/overlays/production"

DO_APPLY=true
DO_RESTART=true
if [ "${1:-}" = "--apply" ]; then
  DO_RESTART=false
elif [ "${1:-}" = "--restart" ]; then
  DO_APPLY=false
fi

if [ "$DO_APPLY" = true ]; then
  echo "=== Applying manifests ==="
  # Use a temp copy to set image names without mutating tracked files
  TMP_OVERLAY=$(mktemp -d /tmp/talos-overlay.XXXXXX)
  trap "rm -rf $TMP_OVERLAY" EXIT
  cp "$OVERLAY_DIR"/* "$TMP_OVERLAY/"
  cd "$TMP_OVERLAY"
  kustomize edit set image claude-workspace="$REGISTRY/claude-workspace:latest"
  kustomize edit set image talos-portal="$REGISTRY/talos-portal:latest"
  kustomize edit set image sandbox-manager="$REGISTRY/sandbox-manager:latest"
  $KUBECTL apply -k .
  cd "$PROJECT_DIR"
fi

if [ "$DO_RESTART" = true ]; then
  echo ""
  echo "=== Restarting deployments (pull latest images) ==="
  $KUBECTL rollout restart deploy/new-api deploy/sandbox-manager deploy/talos-portal -n system
fi

echo ""
echo "=== Waiting for rollouts ==="
$KUBECTL rollout status deploy/new-api -n system --timeout=180s || true
$KUBECTL rollout status deploy/sandbox-manager -n system --timeout=180s || true
$KUBECTL rollout status deploy/talos-portal -n system --timeout=180s || true

echo ""
echo "=== Pod Status ==="
$KUBECTL get pods -n system
