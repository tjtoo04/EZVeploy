/**
 * Client for the VPS agent (agent/). All OS-touching capability — users,
 * daemon sockets, docker ps/logs/stats/stream, the provisioning script —
 * lives on the other side of this fetch boundary.
 */

/** Docker's own container-name shape — the server re-validates it locally. */
export const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

const DEFAULT_AGENT_URL = "http://127.0.0.1:3901";

export function createAgentClient({
  agentUrl = DEFAULT_AGENT_URL,
  agentToken = "",
} = {}) {
  const base = String(agentUrl).replace(/\/+$/, "");

  async function request(path, { method = "GET", body, timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(agentToken ? { authorization: `Bearer ${agentToken}` } : {}),
          ...(body !== undefined
            ? { "content-type": "application/json" }
            : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body (raw log text) */
      }
      return { status: res.status, text, json };
    } catch (err) {
      return { status: 0, error: err.cause?.message || err.message, text: "", json: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    base,
    async health() {
      return request("/health");
    },
    async users() {
      return request("/users");
    },
    async containers() {
      return request("/containers");
    },
    async logs(user, name, lines) {
      return request(
        `/containers/${encodeURIComponent(user)}/${encodeURIComponent(name)}/logs?lines=${lines}`,
      );
    },
    async stats(user, name) {
      return request(
        `/containers/${encodeURIComponent(user)}/${encodeURIComponent(name)}/stats`,
      );
    },
    /** Open the agent SSE stream; resolves once headers are received. */
    stream(user, name, lines) {
      return fetch(
        `${base}/containers/${encodeURIComponent(user)}/${encodeURIComponent(name)}/logs/stream?lines=${lines}`,
        {
          headers: agentToken ? { authorization: `Bearer ${agentToken}` } : {},
        },
      );
    },
    async provision(domain, user) {
      return request("/provision", {
        method: "POST",
        body: { domain, user },
        timeoutMs: 75_000, // agent's 60s script timeout + network margin
      });
    },
  };
}