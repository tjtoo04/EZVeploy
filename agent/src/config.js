import { resolve } from "node:path";

/**
 * Load configuration from the environment.
 * The agent owns every OS-touching capability: /etc/passwd, the per-user
 * rootless docker daemons, and the provisioning script. Every external system
 * is injectable for tests: DOCKER_BIN, PASSWD_FILE, PROVISION_SCRIPT.
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 3901),
    // Shared secret with the API server — every agent route requires it.
    agentToken: env.AGENT_TOKEN || "",
    provisionScript: env.PROVISION_SCRIPT || "",
    userBlocklist: (env.USER_BLOCKLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dockerBin: env.DOCKER_BIN || "docker",
    passwdFile: env.PASSWD_FILE || "/etc/passwd",
    // True when pointed at the test fixtures — /health says so, the UI can
    // label the data honestly (SPEC: demonstration data is marked synthetic).
    fixtureMode: Boolean(env.DOCKER_BIN && env.DOCKER_BIN !== "docker"),
  };
}