#!/bin/bash
set -euo pipefail

echo "Deleting k3d cluster talos-local..."
k3d cluster delete talos-local
echo "Done."
