import Fastify from "fastify";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { authHook } from "./lib/auth.js";
import { loadUsers } from "./lib/users.js";
import { listContainers } from "./lib/containers.js";
import {
  logs,
  stats,
  followLogs,
  CONTAINER_NAME_RE,
} from "./lib/observability.js";
import { createDomainStore } from "./lib/domains.js";
import { normalizeDomain, validateDomain } from "./lib/domains-validate.js";
import { exec } from "./lib/exec.js";

/**
 * Assemble the Fastify app around injected configuration (tests pass a
 * fixture config; src/index.js loads from env).
 */
export function buildApp(config) {
  const app = Fastify({ logger: false, trustProxy: true });
  app.decorate("cfg", config);
  app.addHook("onRequest", authHook(config));

  let usersCache = null;
  const USERS_TTL_MS = 5_000;

  async function users() {
    const now = Date.now();
    if (!usersCache || now - usersCache.at > USERS_TTL_MS) {
      usersCache = { value: await loadUsers(config), at: now };
    }
    return usersCache.value;
  }

  const store = createDomainStore(join(config.dataDir, "domains.json"));

  /**
   * Look up a user + container-name pair, validating both against their
   * allowlisted shapes before anything reaches a command. Null when unknown.
   */
  function resolveContext(us, user, containerName) {
    const found = us.find((u) => u.name === user);
    if (!found) return null;
    const name = String(containerName || "");
    if (!CONTAINER_NAME_RE.test(name)) return null;
    return { user: found, name };
  }

  // ---- API ----

  app.get("/api/health", async () => ({
    ok: true,
    mode: config.fixtureMode ? "fixture" : "live",
  }));

  app.get("/api/users", async () => users());

  app.get("/api/containers", async () => {
    const us = await users();
    return listContainers({ users: us, dockerBin: config.dockerBin });
  });

  app.get("/api/domains", async () => store.list());

  app.post("/api/domains", async (req, reply) => {
    const { domain: raw, user: userName } = req.body ?? {};
    const bad = validateDomain(raw);
    if (bad) return reply.code(422).send({ error: bad });

    const us = await users();
    const user = us.find((u) => u.name === userName);
    if (!user) return reply.code(422).send({ error: "unknown user" });
    if (!config.provisionScript) {
      return reply
        .code(500)
        .send({ error: "PROVISION_SCRIPT is not configured on the server" });
    }

    const domain = normalizeDomain(raw);
    const verdict = await store.reserve(domain);
    if (verdict !== "ok")
      return reply.code(409).send({ error: "domain already provisioned" });

    try {
      const r = await exec(
        ["bash", config.provisionScript, domain, user.name],
        { timeoutMs: 60_000 },
      );
      const lastResult =
        r.stdout.trim() ||
        (r.timedOut ? "timed out after 60s" : r.stderr.trim());
      if (r.code !== 0) {
        return reply
          .code(500)
          .send({
            error: "provisioning failed",
            output: lastResult,
            timedOut: r.timedOut,
          });
      }
      const record = store.makeRecord({ domain, user: user.name, lastResult });
      await store.commit(record);
      return reply.code(201).send(record);
    } finally {
      store.release(domain);
    }
  });

  app.get("/api/containers/:user/:name/logs", async (req, reply) => {
    const us = await users();
    const ctx = resolveContext(us, req.params.user, req.params.name);
    if (!ctx) return reply.code(404).send({ error: "not found" });
    const lines = Math.min(Math.max(Number(req.query.lines || 200), 1), 2000);
    const out = await logs({ ...ctx, lines, dockerBin: config.dockerBin });
    if (out.error === "not-found")
      return reply.code(404).send({ error: "container not found" });
    if (out.error === "daemon")
      return reply.code(502).send({ error: out.stderr });
    return reply.type("text/plain").send(out.text);
  });

  app.get("/api/containers/:user/:name/stats", async (req, reply) => {
    const us = await users();
    const ctx = resolveContext(us, req.params.user, req.params.name);
    if (!ctx) return reply.code(404).send({ error: "not found" });
    const out = await stats({ ...ctx, dockerBin: config.dockerBin });
    if (out.error === "not-found")
      return reply.code(404).send({ error: "container not found" });
    if (out.error === "daemon")
      return reply.code(502).send({ error: out.stderr });
    return out;
  });

  app.get("/api/containers/:user/:name/logs/stream", async (req, reply) => {
    const us = await users();
    const ctx = resolveContext(us, req.params.user, req.params.name);
    if (!ctx) return reply.code(404).send({ error: "not found" });
    const lines = Math.min(Math.max(Number(req.query.lines || 100), 1), 2000);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let closed = false;
    const send = (event, data) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    let wroteAny = false;
    const { child, done } = followLogs(
      { ...ctx, lines, dockerBin: config.dockerBin },
      (line) => {
        wroteAny = true;
        send("log", line);
      },
    );
    const close = () => {
      if (closed) return;
      closed = true;
      try {
        child.kill();
      } catch {
        /* already settled */
      }
      try {
        res.end();
      } catch {
        /* conn already gone */
      }
    };
    done.then(({ stderr }) => {
      if (!wroteAny && stderr.trim()) send("error", stderr.trim());
      close();
    });
    req.raw.on("close", close);
  });

  // ---- Static UI (production) ----

  const distDir = config.uiDist;
  if (distDir) {
    const MIME = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
      ".map": "application/json",
    };
    app.get("/*", async (req, reply) => {
      let url = req.url.split("?")[0];
      if (url === "/" || url === "") url = "/index.html";
      const candidate = join(distDir, url);
      const root = distDir + "/";
      if (
        !candidate.startsWith(root) &&
        candidate !== join(distDir, "index.html")
      ) {
        return reply.code(403).send("forbidden");
      }
      const file =
        existsSync(candidate) && statSync(candidate).isFile()
          ? candidate
          : join(distDir, "index.html");
      const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
      return reply
        .type(MIME[ext] || "application/octet-stream")
        .send(readFileSync(file));
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/"))
      return reply.code(404).send({ error: "not found" });
    return reply.code(404).send("not found");
  });

  return app;
}
