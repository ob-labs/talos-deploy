#!/bin/bash
set -euo pipefail

# ECS one-time initialization script.
# Run this ONCE on a fresh ECS instance to set up k3s + agent-sandbox controller.
#
# Usage:
#   1. Create .env file with REGISTRY, REGISTRY_USERNAME, REGISTRY_PASSWORD
#   2. npm run ecs:init
#
# If the repo is already on ECS (transferred via scp), run from the repo directory.
# If not, this script will try to clone it (may fail on some networks).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

REGISTRY="${REGISTRY:?请设置 REGISTRY (镜像仓库地址)}"
REGISTRY_USERNAME="${REGISTRY_USERNAME:?请设置 REGISTRY_USERNAME}"
REGISTRY_PASSWORD="${REGISTRY_PASSWORD:?请设置 REGISTRY_PASSWORD}"

AGENT_SANDBOX_VERSION="${AGENT_SANDBOX_VERSION:-v0.4.6}"
REPO_DIR="${REPO_DIR:-$PROJECT_DIR}"

echo "=========================================="
echo "  Talos Portal — ECS One-Time Init"
echo "=========================================="
echo ""

# ─── Step 1: Install git ────────────────────────────────────────────
echo "=== Step 1/8: Install git ==="
if command -v git &>/dev/null; then
  echo "git already installed, skipping..."
else
  yum install -y git 2>/dev/null || apt-get install -y git 2>/dev/null
  echo "git installed."
fi

# ─── Step 2: Install k3s ────────────────────────────────────────────
echo ""
echo "=== Step 2/8: Install k3s ==="
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

if k3s kubectl get nodes &>/dev/null 2>&1; then
  echo "k3s already installed and running, skipping..."
else
  # Try normal install first
  if ! curl -sfL https://get.k3s.io | sh -s - server --disable traefik 2>/dev/null; then
    echo "Standard k3s install failed (likely selinux issue), falling back to manual setup..."
    # Download k3s binary
    K3S_VERSION="v1.35.5+k3s1"
    if [ ! -f /usr/local/bin/k3s ]; then
      echo "Downloading k3s binary..."
      curl -sfL "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/k3s" -o /usr/local/bin/k3s
      chmod +x /usr/local/bin/k3s
    fi
    # Register systemd service directly (bypasses selinux RPM issue)
    cat > /etc/systemd/system/k3s.service <<SVCEOF
[Unit]
Description=Lightweight Kubernetes
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/local/bin/k3s server --disable traefik
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
SVCEOF
    systemctl daemon-reload
    systemctl enable --now k3s
    echo "k3s installed (manual service registration)."
  fi

  mkdir -p ~/.kube
  cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
fi

# Wait for k3s to be ready
echo "Waiting for k3s node to be ready..."
NODE_NAME=$(hostname | tr '[:upper:]' '[:lower:]')
k3s kubectl wait --for=condition=Ready "node/${NODE_NAME}" --timeout=120s

echo ""

# ─── Step 3: Configure private registry ──────────────────────────────
echo "=== Step 3/8: Configure private registry ==="
mkdir -p /etc/rancher/k3s

# Extract registry host from full URL (e.g. crpi-xxx.cn-beijing.personal.cr.aliyuncs.com)
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

# ─── Step 4: Install agent-sandbox controller ────────────────────────
echo "=== Step 4/8: Install agent-sandbox controller ==="
k3s kubectl apply -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/manifest.yaml"
k3s kubectl apply -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/extensions.yaml"
echo "agent-sandbox controller installed."

echo ""

# ─── Step 5: Create namespaces ──────────────────────────────────────
echo "=== Step 5/8: Create namespaces ==="
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

# ─── Step 6: Create secrets ─────────────────────────────────────────
echo "=== Step 6/8: Create secrets ==="

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
# Save to file so user won't lose it when updating other secret fields
JWT_FILE="$PROJECT_DIR/.jwt-secret"
if k3s kubectl get secret talos-portal-secrets -n system &>/dev/null; then
  echo "secret/talos-portal-secrets already exists, skipping..."
  # Extract existing JWT to file for later use
  k3s kubectl get secret talos-portal-secrets -n system \
    -o jsonpath='{.data.jwt-secret}' 2>/dev/null | base64 -d > "$JWT_FILE" 2>/dev/null || true
else
  JWT_SECRET="$(openssl rand -hex 32)"
  echo "$JWT_SECRET" > "$JWT_FILE"
  k3s kubectl create secret generic talos-portal-secrets \
    --from-literal=jwt-secret="$JWT_SECRET" \
    --namespace system
  echo "secret/talos-portal-secrets created (JWT saved to $JWT_FILE)"
fi

# ─── Step 7: Install kustomize ──────────────────────────────────────
echo ""
echo "=== Step 7/8: Install kustomize ==="
if command -v kustomize &>/dev/null; then
  echo "kustomize already installed, skipping..."
else
  curl -s "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/master/hack/install_kustomize.sh" | bash
  mv kustomize /usr/local/bin/
  echo "kustomize installed."
fi

# ─── Step 8: Ensure repo is present ─────────────────────────────────
echo ""
echo "=== Step 8/8: Ensure repo is present ==="
if [ -d "$PROJECT_DIR/.git" ]; then
  echo "Repo already at $PROJECT_DIR, skipping..."
else
  REPO_URL="${REPO_URL:-https://github.com/ob-labs/talos-deploy.git}"
  echo "Trying to clone from $REPO_URL ..."
  if timeout 30 git clone "$REPO_URL" "$REPO_DIR" 2>/dev/null; then
    echo "Repo cloned to $REPO_DIR"
  else
    echo ""
    echo "⚠️  git clone failed or timed out (common on China mainland ECS)."
    echo "   Please transfer the repo manually:"
    echo ""
    echo "   # On your local machine:"
    echo "   tar czf talos-deploy.tar.gz --exclude=node_modules /path/to/talos-deploy"
    echo "   scp talos-deploy.tar.gz root@<ECS_IP>:/opt/"
    echo ""
    echo "   # On ECS:"
    echo "   cd /opt && tar xzf talos-deploy.tar.gz"
  fi
fi

echo ""
echo "=========================================="
echo "  ECS Init Complete!"
echo "=========================================="
echo ""
echo "接下来配置上游 LLM API（使用下面的一键命令）："
echo ""
echo "  JWT_SECRET=\$(cat $PROJECT_DIR/.jwt-secret)"
echo "  k3s kubectl create secret generic talos-portal-secrets \\"
echo "    --from-literal=jwt-secret=\"\$JWT_SECRET\" \\"
echo "    --from-literal=upstream-api-key=<你的 API Key> \\"
echo "    --from-literal=upstream-base-url=<你的 Base URL> \\"
echo "    --from-literal=sandbox-default-opus-model=<模型名> \\"
echo "    --from-literal=sandbox-default-sonnet-model=<模型名> \\"
echo "    --from-literal=sandbox-default-haiku-model=<模型名> \\"
echo "    --namespace system --dry-run=client -o yaml | k3s kubectl apply -f -"
echo ""
echo "然后部署："
echo "  cd $PROJECT_DIR"
echo "  npm run ecs:deploy -- --apply   # 首次"
echo "  npm run ecs:deploy -- --restart # 后续更新"
