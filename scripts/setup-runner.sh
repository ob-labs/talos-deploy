#!/bin/bash
set -euo pipefail

# Install and register GitHub Actions self-hosted runner on ECS.
# Run once to enable automated CD from GitHub Actions.
#
# Prerequisites:
#   - Go to: https://github.com/ORG/REPO/settings/actions/runners/new
#   - Select Linux x64 and copy the registration token
#
# Usage:
#   RUNNER_TOKEN=<token> RUNNER_REPO=https://github.com/org/repo ./scripts/setup-runner.sh
#
# With all options:
#   RUNNER_TOKEN=xxx \
#   RUNNER_REPO=https://github.com/ob-labs/talos-deploy \
#   RUNNER_VERSION=2.321.0 \
#   RUNNER_LABELS=ecs,production \
#   RUNNER_NAME=ecs-runner \
#   ./scripts/setup-runner.sh

RUNNER_TOKEN="${RUNNER_TOKEN:?请设置 RUNNER_TOKEN (从 GitHub Settings > Actions > Runners > New runner 获取)}"
RUNNER_REPO="${RUNNER_REPO:?请设置 RUNNER_REPO (e.g. https://github.com/ob-labs/talos-deploy)}"
RUNNER_VERSION="${RUNNER_VERSION:-2.321.0}"
RUNNER_LABELS="${RUNNER_LABELS:-ecs,production}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname | tr '[:upper:]' '[:lower:]')}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner}"

echo "=========================================="
echo "  GitHub Actions Runner Setup"
echo "=========================================="
echo ""
echo "Repo:    $RUNNER_REPO"
echo "Name:    $RUNNER_NAME"
echo "Labels:  $RUNNER_LABELS"
echo "Dir:     $RUNNER_DIR"
echo ""

# ─── Step 1: Create runner directory ────────────────────────────────
echo "=== Step 1/4: Create runner directory ==="
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# ─── Step 2: Download runner package ────────────────────────────────
echo ""
echo "=== Step 2/4: Download runner v${RUNNER_VERSION} ==="
RUNNER_PKG="actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

if [ -f "run.sh" ]; then
  echo "Runner already extracted, skipping download..."
elif [ -f "$RUNNER_PKG" ]; then
  echo "Archive already present, extracting..."
  tar xzf "$RUNNER_PKG"
else
  if ! curl -fsSL --connect-timeout 60 \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_PKG}" \
    -o "$RUNNER_PKG"; then
    echo "ERROR: Failed to download runner. Check network connectivity to github.com."
    exit 1
  fi
  tar xzf "$RUNNER_PKG"
fi
echo "Runner ready."

# ─── Step 3: Register with GitHub ───────────────────────────────────
echo ""
echo "=== Step 3/4: Register runner with GitHub ==="

# Remove stale registration so --replace is safe
if [ -f ".runner" ]; then
  echo "Removing existing runner registration..."
  ./config.sh remove --token "$RUNNER_TOKEN" 2>/dev/null || true
fi

./config.sh \
  --url "$RUNNER_REPO" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --unattended \
  --replace

echo "Runner registered."

# ─── Step 4: Install and start systemd service ──────────────────────
echo ""
echo "=== Step 4/4: Install systemd service ==="

# svc.sh accepts an optional user argument; default to root on ECS
./svc.sh install root 2>/dev/null || ./svc.sh install
./svc.sh start

echo ""
echo "=========================================="
echo "  Runner Setup Complete!"
echo "=========================================="
echo ""
echo "验证 runner 状态："
echo "  systemctl status \"actions.runner.*.service\""
echo ""
echo "在 GitHub 验证（应显示 Idle）："
echo "  $RUNNER_REPO/settings/actions/runners"
echo ""
echo "查看 runner 日志："
echo "  journalctl -u \"actions.runner.*.service\" -f"
