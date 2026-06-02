#!/bin/bash
set -euo pipefail

# Deploy on ECS — pull latest manifest from repo and apply.
# Run this on ECS after SSH-ing in.
#
# Usage:
#   bash scripts/deploy-remote.sh
#
# Prerequisites:
#   - Repo cloned to /opt/talos-deploy (or set REPO_DIR)
#   - k3s installed (scripts/ecs-init.sh)

REPO_DIR="${REPO_DIR:-/opt/talos-deploy}"
KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
export KUBECONFIG

MANIFEST="$REPO_DIR/deploy/manifest.yaml"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found"
  echo "Run: cd /opt && git clone <repo-url> talos-deploy"
  exit 1
fi

echo "=== Pulling latest manifest ==="
cd "$REPO_DIR"
git pull

echo ""
echo "=== Applying manifest ==="
kubectl apply -f "$MANIFEST"

echo ""
echo "=== Waiting for rollouts ==="
kubectl rollout status deploy/new-api -n system --timeout=180s || true
kubectl rollout status deploy/sandbox-manager -n system --timeout=180s || true
kubectl rollout status deploy/talos-portal -n system --timeout=180s || true

echo ""
echo "=== Pod Status ==="
kubectl get pods -n system
