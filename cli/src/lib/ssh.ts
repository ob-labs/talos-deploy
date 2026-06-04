import fs from "fs";
import net from "net";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import WebSocket from "ws";
import { getSshKeyPath, loadConfig, getPortalUrl } from "../config/index.js";
import { api } from "../api/client.js";

// ── SSH key management ─────────────────────────────────

export function ensureSshKey() {
  const keyPath = getSshKeyPath();
  if (!fs.existsSync(keyPath)) {
    console.log("No SSH key found, generating one...");
    execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N ""`, { stdio: "pipe" });
    console.log("SSH key generated.");
  }
}

export async function uploadSshKey() {
  const pubKeyPath = getSshKeyPath() + ".pub";
  const pubKey = fs.readFileSync(pubKeyPath, "utf-8").trim();
  const resp = await api("/api/ssh-keys", {
    method: "POST",
    body: JSON.stringify({ public_key: pubKey, name: "default" }),
  });
  return resp.ok;
}

// ── SSH relay via WebSocket ─────────────────────────────

/**
 * Establish an SSH relay through the Portal's WebSocket endpoint.
 * Creates a local TCP server; when SSH connects, data is piped through
 * WebSocket → Portal → Sandbox Manager → pod SSH.
 */
export function establishSshRelay(
  sandboxId: number
): Promise<{ port: number; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const config = loadConfig();
    const portalUrl = getPortalUrl();

    // Build WebSocket URL with auth token
    const wsBaseUrl = portalUrl.replace(/^http/, "ws");
    const tokenParam = config?.token ? `?token=${encodeURIComponent(config.token)}` : "";
    const wsUrl = `${wsBaseUrl}/api/sandboxes/${sandboxId}/ssh${tokenParam}`;

    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind local server"));
        return;
      }
      const port = addr.port;

      server.on("connection", (tcpSocket) => {
        // Connect WebSocket for this SSH session
        const ws = new WebSocket(wsUrl);
        let closed = false;
        // Buffer TCP data until WebSocket is open
        const pendingData: Buffer[] = [];

        const cleanupSocket = () => {
          if (closed) return;
          closed = true;
          try { ws.close(); } catch {}
          try { tcpSocket.end(); } catch {}
        };

        // Start listening for TCP data immediately (SSH sends handshake right away)
        tcpSocket.on("data", (data: Buffer) => {
          if (closed) return;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          } else {
            pendingData.push(data);
          }
        });

        // WebSocket → TCP
        ws.on("message", (msg: WebSocket.Data) => {
          if (!closed) {
            tcpSocket.write(msg as Buffer);
          }
        });

        ws.on("open", () => {
          // Flush any data buffered while connecting
          while (pendingData.length > 0) {
            const d = pendingData.shift()!;
            ws.send(d);
          }
        });

        ws.on("error", (err) => {
          console.error(`WebSocket error: ${err.message}`);
          cleanupSocket();
        });

        ws.on("close", () => cleanupSocket());
        tcpSocket.on("close", () => cleanupSocket());
        tcpSocket.on("error", () => cleanupSocket());
      });

      resolve({
        port,
        cleanup: () => {
          server.close();
        },
      });
    });

    server.on("error", (err) => reject(err));
  });
}

// ── Legacy: kubectl port-forward (kept as fallback) ────

export function establishPortForward(
  podName: string,
  namespace: string
): Promise<{ port: number; cleanup: () => void }> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const pf = spawn("kubectl", ["port-forward", podName, "0:22", "-n", namespace], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      pf.kill();
      reject(new Error("port-forward timeout (15s)"));
    }, 15_000);

    const onPort = (data: Buffer) => {
      const match = data.toString().match(/Forwarding from\s+\d+\.\d+\.\d+\.\d+:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = parseInt(match[1], 10);
        resolve({
          port,
          cleanup: () => {
            pf.kill();
          },
        });
      }
    };

    pf.stdout!.on("data", onPort);
    pf.stderr!.on("data", onPort);
  });
}

// ── Binary path resolution ─────────────────────────────

export function resolveTalosBinaryPath(
  execFn: (cmd: string) => Buffer = execSync,
  argv: string[] = process.argv
): string {
  try {
    return execFn("which talosd").toString().trim();
  } catch {
    return path.resolve(argv[1]);
  }
}

// ── SSH config update ──────────────────────────────────

export function updateSshConfig(
  project: string,
  binaryPath: string,
  sshConfigPath: string = path.join(os.homedir(), ".ssh/config")
) {
  let content = "";
  if (fs.existsSync(sshConfigPath)) {
    content = fs.readFileSync(sshConfigPath, "utf-8");
  }

  const hostAlias = `tt-${project}`;
  const block =
    `\nHost ${hostAlias}\n` +
    `  User coder\n` +
    `  StrictHostKeyChecking no\n` +
    `  UserKnownHostsFile /dev/null\n` +
    `  IdentityFile ~/.ssh/id_ed25519\n` +
    `  ProxyCommand ${binaryPath} ssh-proxy --project ${project}\n`;

  const regex = new RegExp(`\n?Host ${hostAlias}\n(?:  .*\n)*`);
  if (regex.test(content)) {
    content = content.replace(regex, block);
  } else {
    content += block;
  }

  fs.writeFileSync(sshConfigPath, content);
}

// ── SSH session ────────────────────────────────────────

export function sshIntoSandbox(
  project: string,
  spawnFn: typeof spawn = spawn
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ssh = spawnFn("ssh", [`tt-${project}`], { stdio: "inherit" });

    ssh.on("close", (code) => {
      if (code && code !== 0) {
        reject(new Error(`SSH exited with code ${code}`));
      } else {
        resolve();
      }
    });

    ssh.on("error", (err) => {
      reject(err);
    });
  });
}
