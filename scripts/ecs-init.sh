#!/bin/bash
set -euo pipefail

# ECS one-time initialization script.
# Run this ONCE on a fresh ECS instance to set up k3s + agent-sandbox controller.
#
# Usage:
#   export REGISTRY=registry.cn-hangzhou.aliyuncs.com/yourns
#   export REGISTRY_USERNAME=xxx
#   export REGISTRY_PASSWORD=xxx
#   bash ecs-init.sh
#
# After this script, use CI/CD (push to main) or scripts/deploy.sh for ongoing deploys.

REGISTRY="${REGISTRY:?请设置 REGISTRY (镜像仓库地址)}"
REGISTRY_USERNAME="${REGISTRY_USERNAME:?请设置 REGISTRY_USERNAME}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:?请设置 REGISTRY_PASSWORD}"

AGENT_SANDBOX_VERSION="${AGENT_SANDBOX_VERSION:-v0.4.6}"

echo "=========================================="
echo "  Talos Portal — ECS One-Time Init"
echo "=========================================="
echo ""

# ─── Step 1: Install k3s ─────────────────────────────────────────────
echo "=== Step 1/5: Install k3s ==="
if command -v k3s &>/dev/null && k3s kubectl get nodes &>/dev/null; then
  echo "k3s already installed and running, skipping..."
else
  curl -sfL https://get.k3s.io | sh -s - server --disable traefik
  mkdir -p ~/.kube
  cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
  echo "k3s installed."
fi

# Wait for k3s to be ready
echo "Waiting for k3s node to be ready..."
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
k3s kubectl wait --for=condition=Ready node/$(hostname) --timeout=120s

echo ""

# ─── Step 2: Configure private registry ──────────────────────────────
echo "=== Step 2/5: Configure private registry ==="
mkdir -p /etc/rancher/k3s

# Extract registry host from full URL (e.g. registry.cn-hangzhou.aliyuncs.com)
REGISTRY_HOST=$(echo "$REGISTRY" | sed 's|.*://||' | cut -d'/' -f1)

cat > /etc/rancher/k3s/registries.yaml <<EOF
configs:
  "${REGISTRY_HOST}":
    auth:
      username: ${REGISTRY_USERNAME}
      password: ${REGISTRY_PASSWORD}
EOF

echo "Registry auth configured for: ${REGISTRY_HOST}"
# Restart k3s to pick up registries.yaml
systemctl restart k3s || true
sleep 5
echo "k3s restarted with registry config."

echo ""

# ─── Step 3: Install agent-sandbox controller ────────────────────────
echo "=== Step 3/5: Install agent-sandbox controller ==="
k3s kubectl apply -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/manifest.yaml"
k3s kubectl apply -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/extensions.yaml"
echo "agent-sandbox controller installed."

echo ""

# ─── Step 4: Create namespaces ──────────────────────────────────────
echo "=== Step 4/5: Create namespaces ==="
k3s kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: system
  labels:
    name: system
---
apiVersion: v1
kind: Namespace
metadata:
  name: sandbox-workspaces
  labels:
    name: sandbox-workspaces
EOF
echo "Namespaces created."

echo ""

# ─── Step 5: Create secrets ─────────────────────────────────────────
echo "=== Step 5/5: Create secrets ==="

# new-api session secret
if k3s kubectl get secret new-api-secrets -n system &>/dev/null; then
  echo "secret/new-api-secrets already exists, skipping..."
else
  k3s kubectl create secret generic new-api-secrets \
    --from-literal=session-secret="$(openssl rand -hex 32)" \
    --namespace system
  echo "secret/new-api-secrets created"
fi

# portal JWT secret (generate once, preserve across re-runs)
if k3s kubectl get secret talos-portal-secrets -n system &>/dev/null; then
  echo "secret/talos-portal-secrets already exists, skipping..."
else
  k3s kubectl create secret generic talos-portal-secrets \
    --from-literal=jwt-secret="$(openssl rand -hex 32)" \
    --namespace system
  echo "secret/talos-portal-secrets created (JWT secret generated)"
fi

# ─── Step 6: Clone repo ────────────────────────────────────────────
echo ""
echo "=== Step 6/6: Clone repo ==="
REPO_DIR="${REPO_DIR:-/opt/talos-deploy}"
if [ -d "$REPO_DIR/.git" ]; then
  echo "Repo already cloned at $REPO_DIR, skipping..."
else
  REPO_URL="${REPO_URL:-https://github.com/ob-labs/talos-deploy.git}"
  git clone "$REPO_URL" "$REPO_DIR"
  echo "Repo cloned to $REPO_DIR"
fi

echo ""
echo "=========================================="
echo "  ECS Init Complete!"
echo "=========================================="
echo ""
echo "接下来需要配置 portal secrets 中的上游 API："
echo ""
echo "  k3s kubectl create secret generic talos-portal-secrets \\"
echo "    --from-literal=jwt-secret=<从上面获取> \\"
echo "    --from-literal=upstream-api-key=<你的 API Key> \\"
echo "    --from-literal=upstream-base-url=<你的 Base URL> \\"
echo "    --dry-run=client -o yaml | k3s kubectl apply -f -"
echo ""
echo "之后手动部署："
echo "  ssh 到 ECS → cd $REPO_DIR → bash scripts/deploy-remote.sh"
echo ""
echo "长期方案：在 ECS 上装 self-hosted GitHub Actions runner 实现自动化。"
