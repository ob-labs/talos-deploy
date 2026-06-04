import { FastifyInstance } from "fastify";
import { authMiddleware } from "../auth/index.js";
import {
  createSandbox,
  findSandboxByUserAndProject,
  listUserSandboxes,
  updateSandboxStatus,
  touchSandbox,
  deleteSandbox as deleteSandboxDb,
  findSandboxById,
} from "../db/sandboxes.js";
import { findUserById } from "../db/users.js";
import { getUserPublicKeys } from "../db/ssh-keys.js";
import { ensureUserApiKey } from "../newapi/index.js";
import {
  createSandboxClaim,
  deleteSandboxClaim,
  getSandboxClaimStatus,
  sleepSandbox,
  wakeSandbox,
  waitForSandboxReady,
  getSandboxPodName,
  injectSandboxEnv,
} from "../sandbox-manager/client.js";
import {
  registerOperation,
  emitProgress,
  completeOperation,
  ProgressEvent,
} from "../progress/registry.js";

const NAMESPACE = process.env.SANDBOX_NAMESPACE || "sandbox-workspaces";
const TEMPLATE = process.env.SANDBOX_TEMPLATE || "claude-workspace";
const NEWAPI_BASE = process.env.NEWAPI_BASE || "http://new-api:3000";
const SANDBOX_API_BASE = process.env.SANDBOX_API_BASE || NEWAPI_BASE;

const SANDBOX_EXTRA_ENV: Record<string, string> = Object.fromEntries(
  (
    [
      ["ANTHROPIC_DEFAULT_OPUS_MODEL", process.env.SANDBOX_DEFAULT_OPUS_MODEL],
      ["ANTHROPIC_DEFAULT_SONNET_MODEL", process.env.SANDBOX_DEFAULT_SONNET_MODEL],
      ["ANTHROPIC_DEFAULT_HAIKU_MODEL", process.env.SANDBOX_DEFAULT_HAIKU_MODEL],
      ["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"],
    ] as [string, string | undefined][]
  ).filter(([, v]) => v) as [string, string][]
);

// Total steps for sandbox init
const TOTAL_STEPS = 5;

export async function sandboxRoutes(app: FastifyInstance) {
  app.post("/api/sandboxes", { preHandler: authMiddleware }, async (request, reply) => {
    const { project = "default" } = request.body as any;
    const userId = request.user!.userId;

    // ── Step 1: Verify user is approved ──
    const user = findUserById(userId);
    if (!user || user.status !== "approved") {
      return reply.status(403).send({ error: "Not approved yet" });
    }

    // ── Step 2: Ensure all dependencies are ready (API key, etc.) before touching sandbox ──
    let apiKey: string;
    try {
      apiKey = await ensureUserApiKey(userId);
    } catch (err: any) {
      return reply.status(502).send({ error: `Failed to provision API key: ${err.message}` });
    }

    // ── Step 3: Handle existing sandbox ──
    const existing = findSandboxByUserAndProject(userId, project);
    if (existing) {
      // Verify the sandbox claim still exists in k8s — it may have been deleted externally
      const claimExists = await checkSandboxClaimExists(existing.sandboxclaim_name);
      if (!claimExists) {
        console.log(`Sandbox claim ${existing.sandboxclaim_name} not found in k8s, recreating`);
        deleteSandboxDb(existing.id);
        // Fall through to create a new sandbox below
      } else {
        touchSandbox(existing.id);
        if (existing.status === "sleeping") {
          // Wake with progress tracking (pod will be recreated → env re-injected)
          const operationId = registerOperation(existing.id);
          runSandboxWake(operationId, existing.sandboxclaim_name, existing.id, userId);
          return { sandbox: findSandboxById(existing.id), operationId };
        }
        // Already active — env is already injected in the pod, no need to re-inject
        return { sandbox: findSandboxById(existing.id) };
      }
    }

    // ── Step 4: Create new sandbox with progress tracking ──
    const claimName = `tt-${userId}-${project}`;
    const sandbox = createSandbox(userId, project, claimName);
    const operationId = registerOperation(sandbox.id);
    runSandboxInit(operationId, claimName, sandbox.id, userId);
    return { sandbox, operationId };
  });

/**
 * Check if a sandbox claim still exists in k8s via the Sandbox Manager.
 */
async function checkSandboxClaimExists(claimName: string): Promise<boolean> {
  try {
    const smUrl = process.env.SANDBOX_MANAGER_URL || "http://localhost:8081";
    const resp = await fetch(`${smUrl}/sandboxes/${encodeURIComponent(claimName)}/status`);
    return resp.ok;
  } catch {
    return false;
  }
}

  app.get("/api/sandboxes", { preHandler: authMiddleware }, async (request) => {
    const project = (request.query as any)?.project;
    const sandboxes = listUserSandboxes(request.user!.userId);
    const filtered = project ? sandboxes.filter((s: any) => s.project === project) : sandboxes;
    return { sandboxes: filtered };
  });

  app.get("/api/sandboxes/:id/connection", { preHandler: authMiddleware }, async (request, reply) => {
    const id = Number((request.params as any).id);
    const sb = findSandboxById(id);
    if (!sb || sb.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: "not found" });
    }
    const user = findUserById(sb.user_id);
    if (!user?.api_key) {
      return reply.status(412).send({
        error: "LLM API key not initialized — run 'tt up' to complete account setup.",
      });
    }
    if (sb.status === "sleeping") {
      return reply.status(404).send({ error: "sandbox is sleeping, wake it first" });
    }

    // Wait for K8s claim to be ready (may race with async init)
    const podName = await waitForPod(sb.sandboxclaim_name, NAMESPACE, 30_000);
    if (!podName) return reply.status(404).send({ error: "pod not found" });
    return { podName, namespace: NAMESPACE };
  });

  app.delete("/api/sandboxes/:id", { preHandler: authMiddleware }, async (request, reply) => {
    const id = Number((request.params as any).id);
    const sb = findSandboxById(id);
    if (!sb || sb.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: "not found" });
    }
    await deleteSandboxClaim(sb.sandboxclaim_name, NAMESPACE);
    deleteSandboxDb(id);
    return { ok: true };
  });

  app.post("/api/sandboxes/:id/wake", { preHandler: authMiddleware }, async (request, reply) => {
    const id = Number((request.params as any).id);
    const sb = findSandboxById(id);
    if (!sb || sb.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: "not found" });
    }
    if (sb.status === "sleeping") {
      await wakeSandbox(sb.sandboxclaim_name, NAMESPACE, TEMPLATE);
    }
    const ready = await waitForSandboxReady(sb.sandboxclaim_name, NAMESPACE);
    if (ready) {
      const sshKeys = getUserPublicKeys(sb.user_id);
      const apiKey = await ensureUserApiKey(sb.user_id);
      await injectSandboxEnv(sb.sandboxclaim_name, NAMESPACE, sshKeys, apiKey, SANDBOX_API_BASE, SANDBOX_EXTRA_ENV);
    }
    updateSandboxStatus(id, ready ? "active" : "sleeping");
    touchSandbox(id);
    return { ok: true, ready };
  });

  app.post("/api/sandboxes/:id/sleep", { preHandler: authMiddleware }, async (request, reply) => {
    const id = Number((request.params as any).id);
    const sb = findSandboxById(id);
    if (!sb || sb.user_id !== request.user!.userId) {
      return reply.status(404).send({ error: "not found" });
    }
    if (sb.status === "active") {
      await sleepSandbox(sb.sandboxclaim_name, NAMESPACE);
      updateSandboxStatus(id, "sleeping");
    }
    return { ok: true };
  });
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Poll until the sandbox claim has a pod name ready, or timeout.
 */
async function waitForPod(claimName: string, namespace: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getSandboxClaimStatus(claimName, namespace);
    if (status.sandboxName) {
      const podName = await getSandboxPodName(claimName, namespace);
      if (podName) return podName;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

// ── Progress-tracked operations ─────────────────────────

function step(
  operationId: string,
  stepNum: number,
  stepName: string,
  status: ProgressEvent["status"],
  message?: string
) {
  emitProgress(operationId, {
    step: stepNum,
    totalSteps: TOTAL_STEPS,
    stepName,
    status,
    message,
  });
}

/**
 * Initialize a new sandbox with progress tracking.
 */
function runSandboxInit(operationId: string, claimName: string, sandboxId: number, userId: number) {
  (async () => {
    try {
      // Step 1: Create claim
      step(operationId, 1, "create_claim", "in_progress", `Creating sandbox claim ${claimName}...`);
      await createSandboxClaim(claimName, NAMESPACE, TEMPLATE);
      step(operationId, 1, "create_claim", "completed", `Claim ${claimName} created`);

      // Step 2: Wait for sandbox ready
      step(operationId, 2, "wait_ready", "in_progress", "Waiting for sandbox pod...");
      const ready = await waitForSandboxReady(claimName, NAMESPACE);
      if (!ready) {
        step(operationId, 2, "wait_ready", "failed", "Sandbox did not become ready within timeout");
        updateSandboxStatus(sandboxId, "sleeping");
        completeOperation(operationId, "failed");
        return;
      }
      step(operationId, 2, "wait_ready", "completed", "Sandbox pod is ready");

      // Step 3: Inject environment
      step(operationId, 3, "inject_env", "in_progress", "Injecting SSH keys and API key...");
      const sshKeys = getUserPublicKeys(userId);
      const apiKey = await ensureUserApiKey(userId);
      await injectSandboxEnv(claimName, NAMESPACE, sshKeys, apiKey, SANDBOX_API_BASE, SANDBOX_EXTRA_ENV);
      step(operationId, 3, "inject_env", "completed", "Environment configured");

      // Step 4: Update status
      step(operationId, 4, "activate", "in_progress", "Activating sandbox...");
      updateSandboxStatus(sandboxId, "active");
      touchSandbox(sandboxId);
      step(operationId, 4, "activate", "completed", "Sandbox activated");

      // Step 5: Ready for connection
      step(operationId, 5, "ready", "completed", "Sandbox is ready for connection");

      completeOperation(operationId, "completed");
    } catch (err: any) {
      step(operationId, 0, "error", "failed", err.message);
      completeOperation(operationId, "failed");
    }
  })();
}

/**
 * Wake a sleeping sandbox with progress tracking.
 */
function runSandboxWake(operationId: string, claimName: string, sandboxId: number, userId: number) {
  (async () => {
    try {
      // Step 1: Wake sandbox
      step(operationId, 1, "wake", "in_progress", `Waking sandbox ${claimName}...`);
      await wakeSandbox(claimName, NAMESPACE, TEMPLATE);
      step(operationId, 1, "wake", "completed", "Sandbox woken");

      // Step 2: Wait for ready
      step(operationId, 2, "wait_ready", "in_progress", "Waiting for sandbox pod...");
      const ready = await waitForSandboxReady(claimName, NAMESPACE);
      if (!ready) {
        step(operationId, 2, "wait_ready", "failed", "Sandbox did not become ready within timeout");
        updateSandboxStatus(sandboxId, "sleeping");
        completeOperation(operationId, "failed");
        return;
      }
      step(operationId, 2, "wait_ready", "completed", "Sandbox pod is ready");

      // Step 3: Inject environment
      step(operationId, 3, "inject_env", "in_progress", "Injecting SSH keys and API key...");
      const sshKeys = getUserPublicKeys(userId);
      const apiKey = await ensureUserApiKey(userId);
      await injectSandboxEnv(claimName, NAMESPACE, sshKeys, apiKey, SANDBOX_API_BASE, SANDBOX_EXTRA_ENV);
      step(operationId, 3, "inject_env", "completed", "Environment configured");

      // Step 4: Update status
      step(operationId, 4, "activate", "in_progress", "Activating sandbox...");
      updateSandboxStatus(sandboxId, "active");
      touchSandbox(sandboxId);
      step(operationId, 4, "activate", "completed", "Sandbox activated");

      // Step 5: Ready
      step(operationId, 5, "ready", "completed", "Sandbox is ready for connection");

      completeOperation(operationId, "completed");
    } catch (err: any) {
      step(operationId, 0, "error", "failed", err.message);
      completeOperation(operationId, "failed");
    }
  })();
}
