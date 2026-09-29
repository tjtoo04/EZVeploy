import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { buildApp } from "../src/app.js";

export const AUTH = "Basic " + Buffer.from("admin:secret").toString("base64");
export const authHeaders = { authorization: AUTH };

/** Must match the AGENT_TOKEN the server sends (agent/.env, tests). */
export const AGENT_TOKEN = "test-agent-token";

// The fixture world the agent would report (full user filtering + docker
// simulation live in agent/test — here the agent is a canned HTTP stand-in).
const USERS = [
  { name: "alice", uid: 1001, home: "/home/alice", root: false },
  { name: "bob", uid: 1002, home: "/home/bob", root: false },
  { name: "carol", uid: 1003, home: "/home/carol", root: false },
  { name: "root", uid: 0, home: "/root", root: true },
];

const CONTAINERS = {
  containers: [
    {
      id: "a1b2c3d4e5f6",
      name: "web",
      image: "nginx:1.27",
      status: "Up 3 hours",
      ports: [{ public: "8080", internal: "80", proto: "tcp" }],
      user: "alice",
    },
    {
      id: "f6g7h8i9j0k1",
      name: "db",
      image: "postgres:16",
      status: "Up 3 hours",
      ports: [{ internal: "5432", proto: "tcp" }],
      user: "alice",
    },
    {
      id: "aa11bb22cc33",
      name: "captain",
      image: "ezveploy/panel",
      status: "Up 2 hours",
      ports: [{ public: "3999", internal: "3999", proto: "tcp" }],
      user: "root",
    },
  ],
  daemons: [
    { user: "alice", state: "up" },
    { user: "bob", state: "up" },
    { user: "carol", state: "down" },
    { user: "root", state: "up" },
  ],
};

/**
 * A tiny in-process HTTP stand-in for the agent, so server tests stay
 * hermetic (no OS calls). Sensitive route /provision requires the Bearer
 * token, proving the server relays it.
 */
export async function startFakeAgent({ mode = "fixture" } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://agent");
    const path = url.pathname;
    const send = (code, body, type) => {
      res.writeHead(code, {
        "content-type": type || "application/json",
        "cache-control": "no-store",
      });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };

    if (path === "/health") return send(200, { ok: true, mode });
    if (path === "/users") return send(200, USERS);
    if (path === "/containers") return send(200, CONTAINERS);

    if (path.endsWith("/logs/stream")) {
      const [, name] = path.split("/").slice(2).reverse();
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (name === "nope") {
        res.end(`event: error\ndata: "No such container: nope"\n\n`);
        return;
      }
      res.write(`event: log\ndata: "line one"\n\n`);
      res.write(`event: log\ndata: "followed line four"\n\n`);
      res.end();
      return;
    }

    const m = path.match(/^\/containers\/([^/]+)\/([^/]+)\/(logs|stats)$/);
    if (m) {
      const [, , name, kind] = m;
      if (name === "nope") return send(404, { error: "container not found" });
      if (kind === "logs")
        return send(200, "started container\nlistening on :80\n", "text/plain");
      return send(200, {
        cpu: 0.42,
        memUsed: "12.5 MiB",
        memLimit: "3.9 GiB",
        memPct: 0.32,
        netIo: "1.2 kB / 3.4 kB",
      });
    }

    if (path === "/provision" && req.method === "POST") {
      if (req.headers.authorization !== `Bearer ${AGENT_TOKEN}`)
        return send(401, { error: "unauthorized" });
      let body = "";
      for await (const chunk of req) body += chunk;
      const { domain, user } = JSON.parse(body || "{}");
      const exit = Number(process.env.EZ_PROVISION_EXIT || 0);
      return send(200, {
        code: exit,
        output: `provisioned ${domain} for ${user}`,
        timedOut: false,
      });
    }

    return send(404, { error: "not found" });
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * Build an app with a fake agent on an ephemeral port. Pass `overrides.agentUrl`
 * (e.g. a dead port) to exercise agent-down paths instead.
 */
export async function makeApp(overrides = {}) {
  const dataDir = await mkdtemp("/tmp/ezveploy-test-");
  const fake = overrides.agentUrl ? null : await startFakeAgent();
  const config = {
    host: "127.0.0.1",
    port: 0,
    adminUser: "admin",
    adminPassword: "secret",
    dataDir,
    agentUrl:
      overrides.agentUrl || `http://127.0.0.1:${fake ? fake.port : 0}`,
    agentToken: AGENT_TOKEN,
    uiDist: null,
    ...overrides,
  };
  const app = buildApp(config);
  return {
    app,
    close: async () => {
      if (fake) await fake.close();
    },
  };
}