import { join } from "node:path";
import { buildApp } from "../src/app.js";

export const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

export const AGENT_TOKEN = "test-token";
export const authHeaders = { authorization: `Bearer ${AGENT_TOKEN}` };

/** Build an agent app over the fixture environment. `overrides` win. */
export function makeApp(overrides = {}) {
  const config = {
    host: "127.0.0.1",
    port: 0,
    agentToken: AGENT_TOKEN,
    provisionScript: join(FIXTURES, "provision-domain.sh"),
    userBlocklist: ["mallory"],
    dockerBin: join(FIXTURES, "docker"),
    passwdFile: join(FIXTURES, "passwd"),
    fixtureMode: true,
    ...overrides,
  };
  return buildApp(config);
}