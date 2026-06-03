import { IncomingMessage } from "http";
import WebSocket from "ws";
import { verifyToken } from "../auth/index.js";
import { findSandboxById } from "../db/sandboxes.js";

const SM_BASE = process.env.SANDBOX_MANAGER_URL || "http://localhost:8081";

/**
 * Handle WebSocket SSH relay connections.
 * Called from the WebSocket server in index.ts after upgrade.
 */
export function handleSshRelay(ws: WebSocket, request: IncomingMessage) {
  // ── Auth ──
  const url = new URL(request.url || "/", "http://localhost");
  const token =
    url.searchParams.get("token") ||
    request.headers.authorization?.slice(7);

  if (!token) {
    console.log("ssh relay: no token, closing");
    ws.close(4001, "unauthorized");
    return;
  }

  let payload: any;
  try {
    payload = verifyToken(token);
  } catch {
    console.log("ssh relay: invalid token, closing");
    ws.close(4001, "invalid token");
    return;
  }

  // ── Resolve sandbox ──
  const sandboxId = (ws as any).__sandboxId as number;
  const sb = findSandboxById(sandboxId);
  console.log(`ssh relay: sandbox ${sandboxId}, claim=${sb?.sandboxclaim_name}, status=${sb?.status}, user=${payload.userId}`);
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
  console.log(`ssh relay: connecting to SM at ${smWsUrl}`);
  const smWs = new WebSocket(smWsUrl);
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch {}
    try { smWs.close(); } catch {}
  };

  smWs.on("open", () => {
    console.log(`ssh relay: SM connected, piping data`);
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
    console.error(`ssh relay: SM ws error for sandbox ${sandboxId}:`, err.message);
    cleanup();
  });

  smWs.on("close", () => cleanup());
  ws.on("close", () => cleanup());
}
