import { listActiveSandboxes, updateSandboxStatus } from "../db/sandboxes.js";
import { sleepSandbox } from "../sandbox-manager/client.js";

const NAMESPACE = process.env.SANDBOX_NAMESPACE || "sandbox-workspaces";
const IDLE_MS = Number(process.env.IDLE_HOURS || 5) * 60 * 60 * 1000;
const CHECK_INTERVAL = 10 * 60 * 1000;

export function startIdleChecker() {
  setInterval(checkIdle, CHECK_INTERVAL);
  console.log(`Idle checker started (threshold=${IDLE_MS / 3600000}h, interval=${CHECK_INTERVAL / 60000}m)`);
}

async function checkIdle() {
  const sandboxes = listActiveSandboxes();
  const now = Date.now();

  for (const sb of sandboxes) {
    const lastActive = new Date(sb.last_active_at).getTime();
    if (now - lastActive > IDLE_MS) {
      console.log(`Sandbox ${sb.sandboxclaim_name} idle for >${IDLE_MS / 3600000}h, sleeping (deleting claim)`);
      try {
        await sleepSandbox(sb.sandboxclaim_name, NAMESPACE);
        updateSandboxStatus(sb.id, "sleeping");
      } catch (err) {
        console.error(`Failed to sleep ${sb.sandboxclaim_name}:`, err);
      }
    }
  }
}
