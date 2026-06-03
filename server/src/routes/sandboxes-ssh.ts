import { IncomingMessage } from "http";
import WebSocket from "ws";
import { verifyToken } from "../auth/index.js";
import { findSandboxById } from "../db/sandboxes.js";

const SM_BASE = process.env.SANDBOX_MANAGER_URL || "http://localhost:8081";

/**
 * Handle WebSocket SSH relay connections.
 * Called from the WebSocket server in index.ts after upgrade.
 *
 * Auth: extract Bearer token from the upgrade request's `authorization` header
 * or from the `token` query parameter (for clients that can't set headers).
 */
export function handleSshRelay(ws: WebSocket, request: IncomingMessage) {
  // ── Auth ──
  const url = new URL(request.url || "/", "http://localhost");
  const token =
    url.searchParams.get("token") ||
    request.headers.authorization?.slice(7);

  if (!token) {
    ws.close(4001, "unauthorized");
    return;
  }

  let payload: any;
  try {
    payload = verifyToken(token);
  } catch {
    ws.close(4001, "invalid token");
    return;
  }

  // ── Resolve sandbox ──
  const sandboxId = (ws as any).__sandboxId as number;
  const sb = findSandboxById(sandboxId);
  if (!sb || sb.user_id !== payload.userId) {
    ws.close(4004, "not found");
    return;
  }
  if (sb.status === "sleeping") {
    ws.close(4004, "sandbox is sleeping");
    return;
  }

  // ── Connect to Sandbox Manager WebSocket ──
  const smWsUrl = SM_BASE.replace(/^http/, "ws") + `/sandboxes/${encodeURIComponent(sb.sandboxclaim_name)}/ssh`;
  const smWs = new WebSocket(smWsUrl);
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch {}
    try { smWs.close(); } catch {}
  };

  smWs.on("open", () => {
    // Client → Sandbox Manager
    ws.on("message", (msg: Buffer) => {
      if (!closed) smWs.send(msg);
    });

    // Sandbox Manager → Client
    smWs.on("message", (msg: WebSocket.Data) => {
      if (!closed) ws.send(msg);
    });
  });

  smWs.on("error", (err) => {
    console.error(`ssh relay: sandbox-manager ws error for sandbox ${sandboxId}:`, err.message);
    cleanup();
  });

  smWs.on("close", () => cleanup());
  ws.on("close", () => cleanup());
}
