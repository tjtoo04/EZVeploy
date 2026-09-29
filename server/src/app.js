import Fastify from "fastify";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { authHook } from "./lib/auth.js";
import {
  createAgentClient,
  CONTAINER_NAME_RE,
} from "./lib/agent.js";
import { createDomainStore } from "./lib/domains.js";
import { normalizeDomain, validateDomain } from "./lib/domains-validate.js";

/**
 * Assemble the API app around injected configuration (tests pass a fixture
 * config; src/index.js loads from env). The server is a gateway: Basic auth,
 * the domain registry, and the static UI live here; every OS operation is a
 * call to the VPS agent over AGENT_URL.
 */
export function buildApp(config) {
  const app = Fastify({ logger: false, trustProxy: true });
  app.decorate("cfg", config);
  app.addHook("onRequest", authHook(config));

  const agent = createAgentClient(config);

  let usersCache = null;
  const USERS_TTL_MS = 5_000;

  /** The tenant list always comes from the agent's passwd read. */
  async function users() {
    const now = Date.now();
    if (usersCache && now - usersCache.at > USERS_TTL_MS) return usersCache.value;
    const r = await agent.users();
    if (r.status !== 200 || !Array.isArray(r.json)) {
      if (usersCache) return usersCache.value; // stale beats empty when the agent blips
      throw new Error(r.error || r.text || "agent unreachable");
    }
    usersCache = { value: r.json, at: now };
    return usersCache.value;
  }

  /**
   * Look up a user + container-name pair, validating both against their
   * allowlisted shapes before anything is sent to the agent. Null when unknown.
   */
  function resolveContext(us, user, containerName) {
    const found = us.find((u) => u.name === user);
    if (!found) return null;
    const name = String(containerName || "");
    if (!CONTAINER_NAME_RE.test(name)) return null;
    return { user: found, name };
  }

  const store = createDomainStore(join(config.dataDir, "domains.json"));

  /** The agent's own status mapping (404 vs 502) is relayed unchanged. */
  function agentFailure(reply, r) {
    if (r.status === 404)
      return reply.code(404).send({ error: "container not found" });
    const code = r.status >= 400 && r.status < 600 ? r.status : 502;
    return reply.code(code).send(r.json || { error: r.text || "agent error" });
  }

  // ---- API ----

  app.get("/api/health", async () => {
    const r = await agent.health();
    const ok = r.status === 200;
    return {
      ok: true,
      mode: ok ? r.json?.mode || "live" : "unknown",
      agent: ok ? "ok" : "down",
    };
  });

  app.get("/api/users", async (req, reply) => {
    try {
      return await users();
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
  });

  app.get("/api/containers", async (req, reply) => {
    const r = await agent.containers();
    if (r.status !== 200) return agentFailure(reply, r);
    return r.json;
  });

  app.get("/api/domains", async () => store.list());

  app.post("/api/domains", async (req, reply) => {
    const { domain: raw, user: userName } = req.body ?? {};
    const bad = validateDomain(raw);
    if (bad) return reply.code(422).send({ error: bad });

    let us;
    try {
      us = await users();
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
    const user = us.find((u) => u.name === userName);
    if (!user) return reply.code(422).send({ error: "unknown user" });

    const domain = normalizeDomain(raw);
    const verdict = await store.reserve(domain);
    if (verdict !== "ok")
      return reply.code(409).send({ error: "domain already provisioned" });

    try {
      const r = await agent.provision(domain, user.name);
      if (r.status !== 200) {
        // agent errors (unknown user / unconfigured script / unreachable)
        return reply
          .code(r.status >= 400 && r.status < 600 ? r.status : 502)
          .send(r.json || { error: r.error || "agent error" });
      }
      const { code, output, timedOut } = r.json;
      if (code !== 0) {
        return reply.code(500).send({
          error: "provisioning failed",
          output,
          timedOut,
        });
      }
      const record = store.makeRecord({ domain, user: user.name, lastResult: output });
      await store.commit(record);
      return reply.code(201).send(record);
    } finally {
      store.release(domain);
    }
  });

  app.get("/api/containers/:user/:name/logs", async (req, reply) => {
    try {
      const ctx = resolveContext(await users(), req.params.user, req.params.name);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      const lines = Math.min(Math.max(Number(req.query.lines || 200), 1), 2000);
      const r = await agent.logs(ctx.user.name, ctx.name, lines);
      if (r.status !== 200) return agentFailure(reply, r);
      return reply.type("text/plain").send(r.text);
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
  });

  app.get("/api/containers/:user/:name/stats", async (req, reply) => {
    try {
      const ctx = resolveContext(await users(), req.params.user, req.params.name);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      const r = await agent.stats(ctx.user.name, ctx.name);
      if (r.status !== 200) return agentFailure(reply, r);
      return r.json;
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
  });

  app.get("/api/containers/:user/:name/logs/stream", async (req, reply) => {
    try {
      const ctx = resolveContext(await users(), req.params.user, req.params.name);
      if (!ctx) return reply.code(404).send({ error: "not found" });
      const lines = Math.min(Math.max(Number(req.query.lines || 100), 1), 2000);

      const upstream = await agent.stream(ctx.user.name, ctx.name, lines);
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        return reply.code(502).send({ error: text || "agent stream failed" });
      }

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      const controller = new AbortController();
      const reader = upstream.body.getReader();
      const pump = (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
          /* aborted by disconnect */
        }
        try {
          res.end();
        } catch {
          /* conn gone */
        }
      })();
      req.raw.on("close", () => {
        controller.abort();
        try {
          reader.cancel().catch(() => {});
        } catch {
          /* already settled */
        }
        pump.catch(() => {});
      });
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
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