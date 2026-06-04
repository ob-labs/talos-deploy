import type WebSocket from "ws";
import type { Writable, Readable } from "stream";
import type { Config } from "../config/index.js";
import { loadConfig as defaultLoadConfig, getPortalUrl } from "../config/index.js";
import { api } from "../api/client.js";
import WS from "ws";

export interface SshProxyDeps {
  loadConfig: () => Config | null;
  apiFetch: (path: string, opts?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<any> }>;
  createWebSocket: (url: string) => WebSocket;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  exit: (code: number) => never;
}

const defaultDeps = (): SshProxyDeps => ({
  loadConfig: defaultLoadConfig,
  apiFetch: api as any,
  createWebSocket: (url: string) => new WS(url),
  stdin: process.stdin as unknown as Readable,
  stdout: process.stdout as unknown as Writable,
  stderr: process.stderr as unknown as Writable,
  exit: process.exit,
});

export async function sshProxyCommand(project: string, deps?: Partial<SshProxyDeps>): Promise<void> {
  const { loadConfig, apiFetch, createWebSocket, stdin, stdout, stderr, exit } =
    { ...defaultDeps(), ...deps };

  const config = loadConfig();
  if (!config?.token) {
    stderr.write("Not logged in. Run: talosd auth login\n");
    exit(1);
  }

  const portalUrl = config!.serverUrl || getPortalUrl();

  // Find sandbox
  const resp = await apiFetch(`/api/sandboxes?project=${encodeURIComponent(project)}`);
  const data = await resp.json();
  const sandboxes: any[] = data.sandboxes ?? [];
  const sandbox = sandboxes[0];

  if (!sandbox) {
    stderr.write(`No sandbox found for project "${project}". Run: talosd up --project ${project}\n`);
    exit(1);
  }

  // Wake if sleeping
  if (sandbox.status === "sleeping") {
    stderr.write("Sandbox is sleeping, waking...\n");
    await apiFetch(`/api/sandboxes/${sandbox.id}/wake`, { method: "POST" });
  }

  const wsBaseUrl = portalUrl.replace(/^http/, "ws");
  const wsUrl = `${wsBaseUrl}/api/sandboxes/${sandbox.id}/ssh?token=${encodeURIComponent(config!.token)}`;

  return new Promise<void>((resolve) => {
    const ws = createWebSocket(wsUrl);
    const pendingData: Buffer[] = [];

    stdin.on("data", (chunk: Buffer) => {
      if ((ws as any).readyState === 1 /* OPEN */) {
        ws.send(chunk);
      } else {
        pendingData.push(chunk);
      }
    });

    stdin.on("end", () => {
      ws.close();
    });

    (ws as any).on("open", () => {
      while (pendingData.length > 0) {
        ws.send(pendingData.shift()!);
      }
    });

    (ws as any).on("message", (msg: Buffer) => {
      stdout.write(msg);
    });

    (ws as any).on("close", (_code: number, _reason: Buffer) => {
      resolve();
    });

    (ws as any).on("error", (err: Error) => {
      stderr.write(`Connection error: ${err.message}\n`);
      resolve();
    });
  });
}
