#!/bin/bash
set -euo pipefail

# Remote deploy script — runs ON the ECS server.
# Accepts a pre-rendered k8s manifest YAML and applies it.
# No git, no kustomize, no source code needed.
#
# Usage:
#   cat manifest.yaml | bash scripts/deploy-remote.sh
#   bash scripts/deploy-remote.sh manifest.yaml
#
# This script is intended to be called by CI/CD after rendering kustomize.

KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
export KUBECONFIG

MANIFEST_FILE="${1:-}"

if [ -n "$MANIFEST_FILE" ]; then
  echo "=== Applying manifest from file: $MANIFEST_FILE ==="
  kubectl apply -f "$MANIFEST_FILE"
elif [ ! -t 0 ]; then
  # Read from stdin
  TMPFILE=$(mktemp /tmp/talos-manifest.XXXXXX.yaml)
  trap "rm -f $TMPFILE" EXIT
  cat > "$TMPFILE"
  echo "=== Applying manifest from stdin ($(wc -l < "$TMPFILE") lines) ==="
  kubectl apply -f "$TMPFILE"
else
  echo "Usage: $0 [manifest.yaml]"
  echo "       cat manifest.yaml | $0"
  exit 1
fi

echo ""
echo "=== Waiting for rollouts ==="
kubectl rollout status deploy/new-api -n system --timeout=180s || true
kubectl rollout status deploy/sandbox-manager -n system --timeout=180s || true
kubectl rollout status deploy/talos-portal -n system --timeout=180s || true

echo ""
echo "=== Pod Status ==="
kubectl get pods -n system
