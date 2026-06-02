import http from "http";
import crypto from "crypto";
import { execSync } from "child_process";
import { loadConfig, saveConfig, clearConfig, getPortalUrl } from "../config/index.js";

// ── auth login ──────────────────────────────────────────────

export async function authLoginCommand() {
  const config = loadConfig();
  const portalUrl = getPortalUrl();

  // Already logged in?
  if (config?.token) {
    try {
      const resp = await fetch(`${portalUrl}/api/auth/status`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        if (data.user?.email) {
          console.log(`Already logged in as ${data.user.email}`);
          console.log(`To switch accounts, run: tt auth login --force`);
          return;
        }
      }
    } catch {
      // Token invalid, proceed to fresh login
    }
  }

  // Fresh login via browser authorization
  const state = crypto.randomBytes(16).toString("hex");
  const callbackServer = await startCallbackServer(state);
  const authUrl = `${portalUrl}/auth/cli?port=${callbackServer.port}&state=${state}`;

  console.log("Opening browser for authorization...");
  console.log(`If browser doesn't open, visit: ${authUrl}`);
  openBrowser(authUrl);

  try {
    const token = await callbackServer.tokenPromise;

    // Fetch user info
    try {
      const resp = await fetch(`${portalUrl}/api/auth/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        saveConfig({
          token,
          serverUrl: portalUrl,
          email: data.user?.email ?? "",
          userId: data.user?.userId ?? 0,
        });
        console.log(`Logged in as ${data.user?.email ?? "unknown"}`);
      } else {
        saveConfig({ token, serverUrl: portalUrl });
        console.log("Logged in successfully!");
      }
    } catch {
      saveConfig({ token, serverUrl: portalUrl });
      console.log("Logged in successfully!");
    }
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }
}

// ── auth status ─────────────────────────────────────────────

export async function authStatusCommand() {
  const config = loadConfig();
  const portalUrl = getPortalUrl();

  if (!config?.token) {
    console.log("Not logged in.");
    console.log("Run: tt auth login");
    return;
  }

  try {
    const resp = await fetch(`${portalUrl}/api/auth/status`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      console.log(`${data.user.email} (${data.user.role})`);
      console.log(`Server: ${portalUrl}`);
    } else {
      console.log("Session expired. Run: tt auth login");
    }
  } catch {
    console.log(`Config: ${config.email || "unknown user"}`);
    console.log(`Server: ${portalUrl} (unreachable)`);
  }
}

// ── auth logout ─────────────────────────────────────────────

export function authLogoutCommand() {
  const config = loadConfig();
  if (!config?.token) {
    console.log("Not logged in.");
    return;
  }
  clearConfig();
  console.log(`Logged out${config.email ? ` (${config.email})` : ""}.`);
}

// ── Helpers ─────────────────────────────────────────────────

interface CallbackResult {
  port: number;
  tokenPromise: Promise<string>;
}

function startCallbackServer(expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind local server"));
        return;
      }
      const port = addr.port;

      const tokenPromise = new Promise<string>((resolveToken, rejectToken) => {
        const timeout = setTimeout(() => {
          server.close();
          rejectToken(new Error("Login timed out (120s). Please try again."));
        }, 120_000);

        server.on("request", (req, httpRes) => {
          httpRes.setHeader("Access-Control-Allow-Origin", "*");
          if (req.method === "OPTIONS") {
            httpRes.writeHead(204);
            httpRes.end();
            return;
          }

          const url = new URL(req.url || "/", "http://localhost");
          const reqState = url.searchParams.get("state");
          const reqToken = url.searchParams.get("token");

          if (reqState === expectedState && reqToken) {
            clearTimeout(timeout);
            httpRes.writeHead(200, { "Content-Type": "text/html" });
            httpRes.end("<html><body><h2>Authorized!</h2><p>You can close this tab.</p></body></html>");
            server.close();
            resolveToken(reqToken);
          } else {
            httpRes.writeHead(400, { "Content-Type": "text/plain" });
            httpRes.end("Invalid callback");
          }
        });
      });

      resolve({ port, tokenPromise });
    });
  });
}

function openBrowser(url: string) {
  const openCmd =
    process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  try {
    execSync(`${openCmd} "${url}"`, { stdio: "ignore" });
  } catch {
    // Browser may not be available
  }
}
