/**
 * Thin API client. Same-origin (no CORS), Basic auth comes from the browser's
 * cached credentials. Every function throws ApiError with a `status`.
 *
 * In dev, Vite proxies /api to the Fastify server (ui/vite.config).
 */

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  if (res.status === 401) {
    // fetch with Basic auth cached: the browser usually suppresses the prompt
    // once a 401 has been seen; surface a clear message rather than a loop.
    throw new ApiError("Not signed in. Reload with credentials.", 401, null);
  }
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const message = body?.error || `HTTP ${res.status}`;
    throw new ApiError(message, res.status, body);
  }
  return res.headers.get("content-type")?.includes("application/json")
    ? res.json()
    : res.text();
}

export const api = {
  health: () => request("/api/health"),
  users: () => request("/api/users"),
  containers: () => request("/api/containers"),
  domains: () => request("/api/domains"),
  createDomain: (payload) =>
    request("/api/domains", { method: "POST", body: JSON.stringify(payload) }),
  logs: (user, name, lines = 200) =>
    request(`/api/containers/${user}/${name}/logs?lines=${lines}`),
  stats: (user, name) => request(`/api/containers/${user}/${name}/stats`),
};

/**
 * SSE log-follow. Reconnects with a 1s backoff after every drop; stops only
 * when `stop()` is called. Returns a function to tear it down.
 */
export function followLogs(
  user,
  name,
  { lines = 100, onLog, onError, onReconnect },
) {
  let active = true;
  const retryMs = 1000;
  let source;

  const connect = () => {
    if (!active) return;
    source = new EventSource(
      `/api/containers/${encodeURIComponent(user)}/${encodeURIComponent(name)}/logs/stream?lines=${lines}`,
    );
    source.addEventListener("log", (e) => onLog?.(e.data));
    source.addEventListener("error", (e) => onError?.(e.data));
    source.onerror = () => {
      source?.close();
      if (!active) return;
      onReconnect?.();
      setTimeout(connect, retryMs);
    };
  };

  connect();

  return () => {
    active = false;
    source?.close();
  };
}
