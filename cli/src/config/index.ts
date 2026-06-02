import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";

export const CONFIG_DIR = path.join(os.homedir(), ".talos");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Load .env from current directory or project root
dotenv.config({ path: path.resolve(process.cwd(), ".env") }) ||
  dotenv.config({ path: path.resolve(process.cwd(), "../..", ".env") });

// ── Config schema ──────────────────────────────────────

/** v1 config (current, backward compatible) */
interface ConfigV1 {
  token: string;
}

/** v2 config (new, with user info and server context) */
export interface Config {
  version: 2;
  token: string;
  email: string;
  userId: number;
  serverUrl: string;
  expiresAt?: string;
}

// ── Config loading ─────────────────────────────────────

export function loadConfig(): Config | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    // v1 → treat as legacy (no email/userId), still usable for token
    if (raw.token && !raw.version) {
      return { version: 2, token: raw.token, email: "", userId: 0, serverUrl: "" };
    }
    return raw as Config;
  } catch {
    return null;
  }
}

export function saveConfig(config: Partial<Config> & { token: string }) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadConfig();
  const merged: Config = {
    version: 2,
    token: config.token,
    email: config.email ?? existing?.email ?? "",
    userId: config.userId ?? existing?.userId ?? 0,
    serverUrl: config.serverUrl ?? existing?.serverUrl ?? "",
    expiresAt: config.expiresAt ?? existing?.expiresAt,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function clearConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

// ── Server URL resolution ──────────────────────────────

export function getPortalUrl(): string {
  // Priority: env var > config file > code default
  if (process.env.TALOS_SERVER_URL) {
    return process.env.TALOS_SERVER_URL;
  }
  const config = loadConfig();
  if (config?.serverUrl) {
    return config.serverUrl;
  }
  if (process.env.ENV === "PRODUCTION") {
    if (!process.env.PORTAL_DOMAIN) {
      console.error("Please set PORTAL_DOMAIN for production");
      process.exit(1);
    }
    return `https://${process.env.PORTAL_DOMAIN}`;
  }
  return `http://localhost:${process.env.PORTAL_PORT || "3080"}`;
}

// ── SSH key path ───────────────────────────────────────

export function getSshKeyPath(): string {
  return path.join(os.homedir(), ".ssh/id_ed25519");
}
