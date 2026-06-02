// Node 20+ has built-in fetch

import Database from "better-sqlite3";
import { findUserById, updateUserApiKey } from "../db/users.js";

const NEWAPI_BASE = process.env.NEWAPI_BASE || "http://new-api.system.svc.cluster.local:3000";
const NEWAPI_ROOT_PASSWORD = process.env.NEWAPI_ROOT_PASSWORD || "12345678";
const NEWAPI_DB_PATH = "/data/new-api/one-api.db";
const NEWAPI_USER_QUOTA = parseInt(process.env.NEWAPI_USER_QUOTA || "500000000000"); // ~$500K

let _session: string | null = null;
let _sessionUserId: string = "";

function adminHeaders(): Record<string, string> {
  if (!_session) throw new Error("Not authenticated to New API");
  return { "Content-Type": "application/json", "Accept-Encoding": "identity", Cookie: _session, "New-Api-User": _sessionUserId };
}

async function login(): Promise<void> {
  _session = null;

  const loginResp = await fetch(`${NEWAPI_BASE}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: NEWAPI_ROOT_PASSWORD }),
    redirect: "manual",
  });

  const body = await loginResp.json() as any;
  if (!body.success) throw new Error(`New API login failed: ${body.message}`);

  const setCookie = loginResp.headers.get("set-cookie") || "";
  const sessionMatch = setCookie.match(/session=([^;]+)/);
  if (!sessionMatch) throw new Error(`No session cookie from New API login (status ${loginResp.status})`);

  _session = `session=${sessionMatch[1]}`;
  _sessionUserId = String(body.data?.id ?? "1");
  console.log(`New API session initialized (user id=${_sessionUserId})`);
}

function isUnauthorized(data: any): boolean {
  const msg = String(data.message || "").toLowerCase();
  return !data.success && (msg.includes("unauthorized") || msg.includes("invalid access token"));
}

/**
 * Execute an admin API call with auto-reauth on session expiry.
 * - First attempt: use existing session (or login if none)
 * - If Unauthorized: clear session, re-login, retry once
 */
async function withAdminAuth<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
  if (!_session) await login();

  const result = await fn(adminHeaders());
  if (isUnauthorized(result)) {
    console.log("New API session expired, re-authenticating...");
    await login();
    return fn(adminHeaders());
  }
  return result;
}

// ── Token CRUD ────────────────────────────────────────────

export async function createToken(name: string, remainQuota: number = NEWAPI_USER_QUOTA): Promise<string> {
  const data = await withAdminAuth(async (headers) => {
    const resp = await fetch(`${NEWAPI_BASE}/api/token/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name, remain_quota: remainQuota, unlimited_quota: false }),
    });
    return resp.json() as any;
  });

  if (!data.success) throw new Error(`New API createToken failed: ${data.message}`);

  // API may return key on creation (some versions), otherwise read from shared DB volume
  if (data.data?.key) return data.data.key;
  return readTokenKeyFromDB(name);
}

function readTokenKeyFromDB(tokenName: string): string {
  const db = new Database(NEWAPI_DB_PATH, { readonly: true });
  const row = db.prepare("SELECT key FROM tokens WHERE name = ? ORDER BY id DESC LIMIT 1").get(tokenName) as any;
  db.close();
  if (!row?.key) throw new Error(`Token "${tokenName}" not found in New API DB after creation`);
  return row.key;
}

export async function ensureUserApiKey(userId: number): Promise<string> {
  const user = findUserById(userId);
  if (user?.api_key) return user.api_key;
  console.log(`Creating API key for user ${userId}...`);
  const apiKey = await createToken(`user-${userId}`);
  updateUserApiKey(userId, apiKey);
  return apiKey;
}

export async function getTokenUsage(tokenKey: string): Promise<{ used: number; remain: number }> {
  const data = await withAdminAuth(async (headers) => {
    const resp = await fetch(`${NEWAPI_BASE}/api/token/?key=${tokenKey}`, { headers });
    return resp.json() as any;
  });
  if (!data.success) throw new Error(`New API getTokenUsage failed: ${data.message}`);
  return { used: data.data.used_quota || 0, remain: data.data.remain_quota || 0 };
}

export async function deleteToken(tokenKey: string): Promise<void> {
  await withAdminAuth(async (headers) => {
    const resp = await fetch(`${NEWAPI_BASE}/api/token/?key=${tokenKey}`, { headers });
    const data = await resp.json() as any;
    if (data.success && data.data?.id) {
      await fetch(`${NEWAPI_BASE}/api/token/${data.data.id}`, { method: "DELETE", headers });
    }
  });
}

// ── Channel init ──────────────────────────────────────────

export async function ensureNewApiChannel(): Promise<void> {
  const apiKey = process.env.UPSTREAM_API_KEY;
  const baseUrl = process.env.UPSTREAM_BASE_URL;
  if (!apiKey || !baseUrl) throw new Error("UPSTREAM_API_KEY and UPSTREAM_BASE_URL are required");

  const listData = await withAdminAuth(async (headers) => {
    const resp = await fetch(`${NEWAPI_BASE}/api/channel/?p=0&page_size=1`, { headers });
    return resp.json() as any;
  });

  const items = Array.isArray(listData.data) ? listData.data : (listData.data?.items ?? []);
  const total = listData.data?.total ?? items.length;
  if (listData.success && total > 0) {
    console.log(`new-api already has ${total} channel(s), skipping init`);
    return;
  }

  const channelType = parseInt(process.env.UPSTREAM_CHANNEL_TYPE || "1");
  const models = (process.env.UPSTREAM_MODELS || "claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001")
    .split(",").map((m) => m.trim()).filter(Boolean);

  const createData = await withAdminAuth(async (headers) => {
    const resp = await fetch(`${NEWAPI_BASE}/api/channel/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "default", type: channelType, key: apiKey, base_url: baseUrl, models: models.join(","), status: 1 }),
    });
    return resp.json() as any;
  });

  if (!createData.success) throw new Error(`channel create failed: ${createData.message}`);
  console.log("new-api channel initialized");
}
