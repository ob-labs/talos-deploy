const API = (path: string, opts: RequestInit = {}) => {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (opts.body) headers["Content-Type"] = "application/json";
  // Cookie is auto-sent by the browser. No manual Authorization header needed.
  return fetch(path, { ...opts, headers, credentials: "same-origin" });
};

export default API;
