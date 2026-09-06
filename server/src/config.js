import { resolve } from "node:path";

/**
 * Load configuration from the environment.
 * Every external system is injectable for tests: DOCKER_BIN, PROVISION_SCRIPT,
 * PASSWD_FILE, DATA_DIR.
 */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || "127.0.0.1",
    port: Number(env.PORT || 3900),
    adminUser: env.ADMIN_USER || "admin",
    adminPassword: env.ADMIN_PASSWORD || "change-me",
    // Resolve relative DATA_DIR against cwd (server runs from server/).
    dataDir: resolve(env.DATA_DIR || "./data"),
    provisionScript: env.PROVISION_SCRIPT || "",
    userBlocklist: (env.USER_BLOCKLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dockerBin: env.DOCKER_BIN || "docker",
    passwdFile: env.PASSWD_FILE || "/etc/passwd",
    // True when pointed at the test fixtures — the API says so, the UI can
    // label the data honestly (SPEC: demonstration data is marked synthetic).
    fixtureMode: Boolean(env.DOCKER_BIN && env.DOCKER_BIN !== "docker"),
  };
}
