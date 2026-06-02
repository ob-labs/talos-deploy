const BASE = process.env.SANDBOX_MANAGER_URL || "http://localhost:8081";

async function api(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}${path}`, { ...opts, headers });
}

export async function createSandboxClaim(
  name: string,
  namespace: string,
  templateName: string
): Promise<void> {
  const resp = await api(`/sandboxes?name=${encodeURIComponent(name)}`, {
    method: "POST",
    body: JSON.stringify({ templateName }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(data.error || `create claim failed: ${resp.status}`);
  }
}

export async function deleteSandboxClaim(name: string, namespace: string): Promise<void> {
  await api(`/sandboxes/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function getSandboxClaimStatus(name: string, namespace: string): Promise<{
  ready: boolean;
  sandboxName?: string;
}> {
  const resp = await api(`/sandboxes/${encodeURIComponent(name)}/status`);
  if (!resp.ok) return { ready: false };
  return resp.json();
}

export async function getSandboxPodName(sandboxName: string, namespace: string): Promise<string | null> {
  const resp = await api(`/sandboxes/${encodeURIComponent(sandboxName)}/pod`);
  if (!resp.ok) return null;
  const data = await resp.json() as any;
  return data.podName || null;
}

export async function waitForSandboxReady(name: string, namespace: string, timeoutMs = 120000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getSandboxClaimStatus(name, namespace);
    if (status.ready) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

export async function sleepSandbox(claimName: string, namespace: string): Promise<void> {
  await deleteSandboxClaim(claimName, namespace);
}

export async function wakeSandbox(
  claimName: string,
  namespace: string,
  templateName: string
): Promise<void> {
  await api(`/sandboxes/${encodeURIComponent(claimName)}/wake`, {
    method: "POST",
    body: JSON.stringify({ templateName }),
  });
}

export async function injectSandboxEnv(
  claimName: string,
  namespace: string,
  sshKeys: string[],
  apiKey: string,
  apiBase: string,
  extraEnv: Record<string, string> = {}
): Promise<void> {
  await api(`/sandboxes/${encodeURIComponent(claimName)}/env`, {
    method: "POST",
    body: JSON.stringify({ sshKeys, apiKey, apiBase, extraEnv }),
  });
}
