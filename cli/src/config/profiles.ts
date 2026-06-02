/**
 * Deployment profiles determine how the CLI interacts with the server
 * and sandbox infrastructure.
 */

export interface DeploymentProfile {
  name: string;
  /** Whether sandbox backend uses K8s or mock in-memory */
  sandboxMode: "mock" | "k8s";
  /** Whether kubectl is needed locally (for port-forward) */
  requiresKubectl: boolean;
  /** Whether SSH into sandbox is available */
  sshAvailable: boolean;
}

export const PROFILES: Record<string, DeploymentProfile> = {
  mock: {
    name: "mock",
    sandboxMode: "mock",
    requiresKubectl: false,
    sshAvailable: false,
  },
  "local-k3d": {
    name: "local-k3d",
    sandboxMode: "k8s",
    requiresKubectl: true,
    sshAvailable: true,
  },
  "remote-k3d": {
    name: "remote-k3d",
    sandboxMode: "k8s",
    requiresKubectl: false,
    sshAvailable: true,
  },
};

/**
 * Detect the active deployment profile.
 * Priority: TALOS_PROFILE env > SANDBOX_MODE env > auto-detect
 */
export function detectProfile(): DeploymentProfile {
  const profileName = process.env.TALOS_PROFILE;
  if (profileName && PROFILES[profileName]) {
    return PROFILES[profileName];
  }

  const sandboxMode = process.env.SANDBOX_MODE;
  if (sandboxMode === "mock") return PROFILES.mock;
  if (sandboxMode === "k8s") return PROFILES["local-k3d"];

  // Auto-detect: check if kubectl has a current context
  try {
    const { execSync } = require("node:child_process");
    const ctx = execSync("kubectl config current-context 2>/dev/null", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (ctx) return PROFILES["local-k3d"];
  } catch {
    // kubectl not available or no context
  }

  return PROFILES.mock;
}
