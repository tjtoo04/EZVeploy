import { resolve } from "node:path";

/**
 * Load configuration from the environment.
 * The server is now a pure HTTP gateway: it owns auth, the domain registry,
 * and the static UI, and delegates every OS-touching capability to the VPS
 * agent (see agent/) over AGENT_URL. Data stays injectable for tests (DATA_DIR).
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 3900),
    adminUser: env.ADMIN_USER || "admin",
    adminPassword: env.ADMIN_PASSWORD || "change-me",
    // Resolve relative DATA_DIR against cwd (server runs from server/).
    dataDir: resolve(env.DATA_DIR || "./data"),
    // The VPS agent — localhost-only, Bearer-token protected.
    agentUrl: env.AGENT_URL || "http://127.0.0.1:3901",
    // Must match AGENT_TOKEN in the agent's .env.
    agentToken: env.AGENT_TOKEN || "",
  };
}