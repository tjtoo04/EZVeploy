import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { buildApp } from "../src/app.js";

export const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

export const AUTH = "Basic " + Buffer.from("admin:secret").toString("base64");

/** Build an app over the fixture environment. `overrides` win over defaults. */
export async function makeApp(overrides = {}) {
  const dataDir = await mkdtemp(join(FIXTURES, ".tmp-"));
  const config = {
    host: "127.0.0.1",
    port: 0,
    adminUser: "admin",
    adminPassword: "secret",
    dataDir,
    provisionScript: join(FIXTURES, "provision-domain.sh"),
    userBlocklist: ["mallory"],
    dockerBin: join(FIXTURES, "docker"),
    passwdFile: join(FIXTURES, "passwd"),
    uiDist: null,
    fixtureMode: true,
    ...overrides,
  };
  return buildApp(config);
}

export const authHeaders = { authorization: AUTH };
