#!/bin/bash
set -euo pipefail

# Deploy to production K8s cluster.
# Can be used in two modes:
#
#   1. Direct apply (default): renders kustomize + applies to current kubectl context
#      REGISTRY=xxx IMAGE_TAG=latest ./scripts/deploy.sh
#
#   2. Render only: outputs the full YAML to stdout (for piping to remote server)
#      REGISTRY=xxx IMAGE_TAG=latest ./scripts/deploy.sh --render > manifest.yaml
#
#   3. Render + deploy to remote ECS via SSH
#      REGISTRY=xxx IMAGE_TAG=latest \
#        ECS_HOST=1.2.3.4 ECS_USER=root \
#        ./scripts/deploy.sh --remote

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

REGISTRY="${REGISTRY:?请设置 REGISTRY 变量 (e.g. registry.cn-hangzhou.aliyuncs.com/yourns)}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
OVERLAY_DIR="$PROJECT_DIR/infra/overlays/production"

MODE="apply"
if [ "${1:-}" = "--render" ]; then
  MODE="render"
elif [ "${1:-}" = "--remote" ]; then
  MODE="remote"
fi

# ─── Render kustomize ────────────────────────────────────────────────
echo "=== Rendering kustomize (tag=${IMAGE_TAG}) ===" >&2

# Work on a temp copy so we don't mutate the original kustomization.yaml
TMP_OVERLAY=$(mktemp -d /tmp/talos-overlay.XXXXXX)
trap "rm -rf $TMP_OVERLAY" EXIT
cp "$OVERLAY_DIR/kustomization.yaml" "$TMP_OVERLAY/"

cd "$TMP_OVERLAY"
kustomize edit set image claude-workspace="$REGISTRY/claude-workspace:$IMAGE_TAG"
kustomize edit set image talos-portal="$REGISTRY/talos-portal:$IMAGE_TAG"
kustomize edit set image sandbox-manager="$REGISTRY/sandbox-manager:$IMAGE_TAG"

MANIFEST=$(kustomize build .)
cd "$PROJECT_DIR"

echo "Rendered $(echo "$MANIFEST" | grep -c '^---') resources" >&2

# ─── Apply based on mode ─────────────────────────────────────────────
case "$MODE" in
  render)
    echo "$MANIFEST"
    echo "" >&2
    echo "=== Manifest rendered to stdout ===" >&2
    ;;

  remote)
    ECS_HOST="${ECS_HOST:?--remote mode requires ECS_HOST}"
    ECS_USER="${ECS_USER:-root}"
    ECS_SSH_KEY="${ECS_SSH_KEY:-~/.ssh/id_rsa}"
    REMOTE_DIR="${ECS_REMOTE_DIR:-/opt/talos}"

    echo "=== Deploying to ${ECS_USER}@${ECS_HOST} ===" >&2
    # Copy deploy-remote.sh and manifest to remote, then apply
    echo "$MANIFEST" | ssh -i "$ECS_SSH_KEY" -o StrictHostKeyChecking=no \
      "${ECS_USER}@${ECS_HOST}" \
      "mkdir -p ${REMOTE_DIR} && cat > ${REMOTE_DIR}/manifest.yaml && bash -s" < "$SCRIPT_DIR/deploy-remote.sh" "${REMOTE_DIR}/manifest.yaml"
    echo "" >&2
    echo "=== Remote deploy complete ===" >&2
    ;;

  apply)
    echo "$MANIFEST" | kubectl apply -f -

    echo ""
    echo "=== Waiting for rollouts ==="
    kubectl rollout status deploy/new-api -n system --timeout=180s || true
    kubectl rollout status deploy/sandbox-manager -n system --timeout=180s || true
    kubectl rollout status deploy/talos-portal -n system --timeout=180s || true
    kubectl get pods -n system
    ;;
esac
