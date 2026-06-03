// Node 20+ has built-in fetch

import { findUserById, updateUserApiKey } from "../db/users.js";

const NEWAPI_BASE = process.env.NEWAPI_BASE || "http://new-api.system.svc.cluster.local:3000";
const NEWAPI_ROOT_PASSWORD = process.env.NEWAPI_ROOT_PASSWORD || "12345678";
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

// ── Startup initialization ────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ensure the root user exists in New API.
 * Try login first — if it succeeds, user exists and password matches.
 * If login fails, try to register via /api/user/register.
 */
async function ensureRootUser(): Promise<void> {
  // Try login first — if it works, user exists
  try {
    await login();
    return;
  } catch {
    // Login failed — user may not exist or password mismatch
  }

  // Try to register
  const resp = await fetch(`${NEWAPI_BASE}/api/user/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: NEWAPI_ROOT_PASSWORD }),
  });
  const data = await resp.json() as any;

  if (data.success) {
    console.log("New API root user registered");
    return;
  }

  // "already exists" is OK — it means the user is there but with a different password
  const msg = String(data.message || "").toLowerCase();
  if (msg.includes("already") || msg.includes("exist") || msg.includes("duplicate")) {
    console.warn("New API root user exists but password may differ from NEWAPI_ROOT_PASSWORD");
    console.warn("If login fails, update root password in New API to match NEWAPI_ROOT_PASSWORD");
    return;
  }

  throw new Error(`register root failed: ${data.message}`);
}

/**
 * Verify the current session works and check admin role.
 * Calls GET /api/user/self to validate session and inspect role.
 * role >= 100 = admin, role 1 = regular user.
 */
async function verifySession(): Promise<void> {
  if (!_session) throw new Error("No session to verify");

  const resp = await fetch(`${NEWAPI_BASE}/api/user/self`, { headers: adminHeaders() });
  const data = await resp.json() as any;

  if (!data.success) {
    throw new Error(`session verification failed: ${data.message}`);
  }

  const role = data.data?.role ?? 0;
  if (role < 100) {
    console.error("");
    console.error("═══════════════════════════════════════════════════════════");
    console.error("WARNING: New API root user is NOT an admin (role=" + role + ")");
    console.error("Channel creation and other admin operations will fail.");
    console.error("Fix: run this command on the ECS server:");
    console.error("  k3s kubectl exec deploy/new-api -n system -- sh -c \\");
    console.error('    "sqlite3 /data/one-api.db \\"UPDATE users SET role=100 WHERE username=\'root\';\\" "');
    console.error("═══════════════════════════════════════════════════════════");
    console.error("");
    throw new Error("root user lacks admin privileges (role=" + role + ", need 100+)");
  }

  console.log(`New API session verified (role=${role}, admin=true)`);
}

/**
 * Initialize New API session at Portal startup.
 * Blocking — ensures a valid admin session exists before the Portal accepts traffic.
 * Retries up to 6 times with increasing backoff if New API isn't ready yet.
 */
export async function initNewApi(): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await ensureRootUser();     // Register root user if needed
      if (!_session) await login(); // Login (ensureRootUser may have already logged in)
      await verifySession();       // Verify session + admin role
      console.log("New API initialization complete");
      return;
    } catch (e: any) {
      _session = null; // Clear stale session
      console.warn(`New API init attempt ${attempt}/6 failed: ${e.message}`);
      if (attempt < 6) {
        await sleep(5000 * attempt);
      }
    }
  }
  // Not fatal — Portal can still serve, but API key features won't work
  console.error("WARNING: New API session not established. API key features unavailable.");
  console.error("Check that New API is running and NEWAPI_ROOT_PASSWORD is correct.");
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

  // API may return key on creation (some versions)
  if (data.data?.key) return data.data.key;

  // Fallback: query token via API (works in k8s where DB volume isn't shared)
  return queryTokenKey(name);
}

async function queryTokenKey(tokenName: string): Promise<string> {
  const data = await withAdminAuth(async (headers) => {
    const resp = await fetch(`${NEWAPI_BASE}/api/token/?name=${encodeURIComponent(tokenName)}`, { headers });
    return resp.json() as any;
  });
  const items = Array.isArray(data.data) ? data.data : (data.data?.items ?? []);
  const token = items.find((t: any) => t.name === tokenName);
  if (token?.key) return token.key;
  throw new Error(`Token "${tokenName}" not found via New API after creation`);
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
