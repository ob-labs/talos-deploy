#!/bin/bash
set -euo pipefail

# Scenario 2: All-in-K3d setup
# Creates a k3d cluster, builds/imports all images locally, creates secrets,
# and deploys all services. No Docker Compose needed.
#
# Usage: ./scripts/k3d-infra.sh
# Access: Portal http://localhost:3080, New API http://localhost:3081

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

PORTAL_PORT="${PORTAL_PORT:-3080}"
NEWAPI_PORT="${NEWAPI_PORT:-3081}"

if [ -z "${UPSTREAM_API_KEY:-}" ] || [ -z "${UPSTREAM_BASE_URL:-}" ]; then
  echo "WARNING: UPSTREAM_API_KEY or UPSTREAM_BASE_URL not set in .env"
  echo "         'claude' inside sandboxes will NOT work until these are configured"
fi

echo "=== Step 1: Create k3d cluster ==="
if k3d kubeconfig get talos-local &>/dev/null; then
  echo "Cluster talos-local already exists, skipping..."
else
  k3d cluster create talos-local \
    --registry-create talos-registry:0.0.0.0:32000 \
    --k3s-arg "--disable=traefik@server:0" \
    -p "${PORTAL_PORT}:30002@server:0" \
    -p "${NEWAPI_PORT}:30001@server:0" \
    --agents 1
fi
k3d kubeconfig merge talos-local --kubeconfig-merge-default --kubeconfig-switch-context

echo ""
echo "=== Step 2: Build and import images ==="

echo "Building workspace image..."
docker build -t localhost:32000/claude-workspace:latest "$PROJECT_DIR/images/workspace"
docker push localhost:32000/claude-workspace:latest
k3d image import localhost:32000/claude-workspace:latest -c talos-local

echo "Building sandbox-manager image..."
docker build -t localhost:32000/sandbox-manager:latest "$PROJECT_DIR/sandbox-manager"
docker push localhost:32000/sandbox-manager:latest
k3d image import localhost:32000/sandbox-manager:latest -c talos-local

echo "Building portal image..."
docker build -t localhost:32000/talos-portal:latest "$PROJECT_DIR/server"
docker push localhost:32000/talos-portal:latest
k3d image import localhost:32000/talos-portal:latest -c talos-local

echo ""
echo "=== Step 3: Import system images ==="
SYSTEM_IMAGES=(
  rancher/mirrored-library-busybox:1.36.1
  rancher/mirrored-pause:3.6
  calciumion/new-api:latest
  rancher/local-path-provisioner:v0.0.30
  rancher/mirrored-coredns-coredns:1.12.0
  rancher/mirrored-metrics-server:v0.7.2
)
for img in "${SYSTEM_IMAGES[@]}"; do
  docker image inspect "$img" &>/dev/null || docker pull "$img"
done
k3d image import "${SYSTEM_IMAGES[@]}" -c talos-local

echo ""
echo "=== Step 4: Install agent-sandbox controller ==="
AGENT_SANDBOX_VERSION="${AGENT_SANDBOX_VERSION:-v0.4.6}"
kubectl apply -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/manifest.yaml"
kubectl apply -f "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/${AGENT_SANDBOX_VERSION}/extensions.yaml"

echo ""
echo "=== Step 5: Create namespaces and secrets ==="
kubectl apply -f "$PROJECT_DIR/infra/base/namespace.yaml"

if kubectl get secret new-api-secrets -n system &>/dev/null; then
  echo "secret/new-api-secrets already exists, skipping..."
else
  kubectl create secret generic new-api-secrets \
    --from-literal=session-secret="$(openssl rand -hex 32)" \
    --namespace system
  echo "secret/new-api-secrets created"
fi

# Preserve existing jwt-secret across re-runs; generate only on first run
if kubectl get secret talos-portal-secrets -n system &>/dev/null 2>&1; then
  _JWT_SECRET=$(kubectl get secret talos-portal-secrets -n system -o jsonpath='{.data.jwt-secret}' | base64 -d)
else
  _JWT_SECRET="$(openssl rand -hex 32)"
fi
kubectl create secret generic talos-portal-secrets \
  --from-literal=jwt-secret="${_JWT_SECRET}" \
  --from-literal=upstream-api-key="${UPSTREAM_API_KEY:-}" \
  --from-literal=upstream-base-url="${UPSTREAM_BASE_URL:-}" \
  --from-literal=sandbox-default-opus-model="${SANDBOX_DEFAULT_OPUS_MODEL:-}" \
  --from-literal=sandbox-default-sonnet-model="${SANDBOX_DEFAULT_SONNET_MODEL:-}" \
  --from-literal=sandbox-default-haiku-model="${SANDBOX_DEFAULT_HAIKU_MODEL:-}" \
  --namespace system \
  --dry-run=client -o yaml | kubectl apply -f -
echo "secret/talos-portal-secrets applied"

echo ""
echo "=== Step 6: Apply kustomize ==="
kubectl apply -k "$PROJECT_DIR/infra/overlays/local"

echo ""
echo "=== Step 7: Wait for services ==="
kubectl wait deploy/agent-sandbox-controller -n agent-sandbox-system --for=condition=Available --timeout=120s || echo "Warning: controller not ready"
kubectl wait deploy/talos-portal -n system --for=condition=Available --timeout=120s || echo "Warning: portal not ready"
kubectl wait deploy/new-api -n system --for=condition=Available --timeout=120s || echo "Warning: new-api not ready"
kubectl wait deploy/sandbox-manager -n system --for=condition=Available --timeout=120s || echo "Warning: sandbox-manager not ready"

echo ""
echo "=== Step 8: Initialize new-api channel and settings ==="
_NEWAPI_POD=$(kubectl get pod -n system -l app=new-api -o jsonpath='{.items[0].metadata.name}')
_TMP_DB="$(mktemp /tmp/new-api-init.XXXXXX.db)"
kubectl cp "system/${_NEWAPI_POD}:/data/one-api.db" "$_TMP_DB"
_NOW=$(date +%s)
_MODELS="${UPSTREAM_MODELS:-claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001}"

# Build ability inserts for each model
_ABILITY_SQL=""
IFS=',' read -ra _MODEL_LIST <<< "$_MODELS"
for _m in "${_MODEL_LIST[@]}"; do
  _m="${_m// /}"  # trim spaces
  _ABILITY_SQL+="INSERT OR REPLACE INTO abilities (\"group\", model, channel_id, enabled, priority, weight) VALUES ('default', '${_m}', 1, 1, 0, 0);"$'\n'
done

_USER_QUOTA="${NEWAPI_USER_QUOTA:-500000000000}"

sqlite3 "$_TMP_DB" "
UPDATE users SET \"group\"='default', quota=${_USER_QUOTA} WHERE id=1;
UPDATE users SET \"group\"='default', quota=${_USER_QUOTA} WHERE username='root';
INSERT OR IGNORE INTO channels (type, key, status, name, weight, created_time, base_url, models, \"group\", model_mapping, priority, auto_ban) VALUES (${UPSTREAM_CHANNEL_TYPE:-1}, '${UPSTREAM_API_KEY:-}', 1, 'default', 0, ${_NOW}, '${UPSTREAM_BASE_URL:-}', '${_MODELS}', 'default', '', 0, 1);
${_ABILITY_SQL}
INSERT OR REPLACE INTO options (key, value) VALUES ('SelfUseModeEnabled', 'true');
"
kubectl cp "$_TMP_DB" "system/${_NEWAPI_POD}:/data/one-api.db"
rm -f "$_TMP_DB"
kubectl rollout restart deployment/new-api -n system
kubectl rollout status deployment/new-api -n system --timeout=60s

# Auto-create admin token for portal to use
_NEWAPI_POD2=$(kubectl get pod -n system -l app=new-api -o jsonpath='{.items[0].metadata.name}')
_ADMIN_TOKEN=$(kubectl exec -n system "$_NEWAPI_POD2" -- \
  sh -c 'sqlite3 /data/one-api.db "SELECT key FROM tokens WHERE name = '\''admin-token'\'' LIMIT 1"' 2>/dev/null || true)

if [ -z "$_ADMIN_TOKEN" ]; then
  echo "Creating New API admin token..."
  _ADMIN_TOKEN=$(kubectl exec -n system "$_NEWAPI_POD2" -- \
    sh -c "sqlite3 /data/one-api.db \"INSERT INTO tokens (name, user_id, key, status, created_time, remain_quota, unlimited_quota) VALUES ('admin-token', 1, 'sk-admin-' || lower(hex(randomblob(16))), 1, $(date +%s), 500000000000, 0); SELECT key FROM tokens WHERE name='admin-token' LIMIT 1;\"")
fi

if [ -n "$_ADMIN_TOKEN" ]; then
  # Update portal secret with the admin token
  _JWT_SECRET=$(kubectl get secret talos-portal-secrets -n system -o jsonpath='{.data.jwt-secret}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
  kubectl create secret generic talos-portal-secrets \
    --from-literal=jwt-secret="${_JWT_SECRET:-$(openssl rand -hex 32)}" \
    --from-literal=newapi-admin-token="${_ADMIN_TOKEN}" \
    --from-literal=upstream-api-key="${UPSTREAM_API_KEY:-}" \
    --from-literal=upstream-base-url="${UPSTREAM_BASE_URL:-}" \
    --from-literal=sandbox-default-opus-model="${SANDBOX_DEFAULT_OPUS_MODEL:-}" \
    --from-literal=sandbox-default-sonnet-model="${SANDBOX_DEFAULT_SONNET_MODEL:-}" \
    --from-literal=sandbox-default-haiku-model="${SANDBOX_DEFAULT_HAIKU_MODEL:-}" \
    --namespace system \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "New API admin token configured: ${_ADMIN_TOKEN:0:10}..."
  # Restart portal to pick up the new secret
  kubectl rollout restart deployment/talos-portal -n system
else
  echo "WARNING: Failed to create New API admin token. Portal will use session fallback."
fi

echo "new-api initialized"

echo ""
echo "=== Cleanup dangling images ==="
docker image prune -f 2>/dev/null

echo ""
echo "=== Status ==="
kubectl get pods -n system
kubectl get pods -n agent-sandbox-system
kubectl get sandboxwarmpool -n sandbox-workspaces 2>/dev/null || true

echo ""
echo "=== Ready ==="
echo "Portal:  http://localhost:${PORTAL_PORT}  (admin@talos.dev / admin)"
echo "New API: http://localhost:${NEWAPI_PORT}  (root / 123654)"
echo ""
echo "Dev commands:"
echo "  ./scripts/dev-rebuild.sh portal          # Rebuild portal after code changes"
echo "  ./scripts/dev-rebuild.sh sandbox-manager  # Rebuild sandbox-manager"
echo "  ./scripts/dev-logs.sh portal             # Tail portal logs"
echo "  ./scripts/k3d-down.sh                    # Destroy cluster"
