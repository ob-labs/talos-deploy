import { loadConfig, getPortalUrl } from "../config/index.js";

/**
 * Authenticated API client.
 * Loads token from config and attaches Bearer header.
 */
export async function api(path: string, options: RequestInit = {}) {
  const config = loadConfig();
  if (!config) {
    console.error("Not logged in. Run: tt login");
    process.exit(1);
  }
  const portalUrl = getPortalUrl();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
  };
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }
  const resp = await fetch(`${portalUrl}${path}`, {
    ...options,
    headers,
  });
  if (resp.status === 401) {
    console.error("Session expired. Run: tt login");
    process.exit(1);
  }
  return resp;
}
