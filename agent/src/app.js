import Fastify from "fastify";
import { tokenHook } from "./lib/token.js";
import { loadUsers } from "./lib/users.js";
import { listContainers } from "./lib/containers.js";
import {
  logs,
  stats,
  followLogs,
  CONTAINER_NAME_RE,
} from "./lib/observability.js";
import { provision } from "./lib/provision.js";

/**
 * Assemble the agent app around injected configuration (tests pass a
 * fixture config; src/index.js loads from env). The agent owns every
 * OS-touching capability; the API server calls it over localhost.
 */
export function buildApp(config) {
  const app = Fastify({ logger: false, trustProxy: true });
  app.decorate("cfg", config);
  app.addHook("onRequest", tokenHook(config));

  let usersCache = null;
  const USERS_TTL_MS = 5_000;

  async function users() {
    const now = Date.now();
    if (!usersCache || now - usersCache.at > USERS_TTL_MS) {
      usersCache = { value: await loadUsers(config), at: now };
    }
    return usersCache.value;
  }

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

  // ---- Internal API (talked to by the API server only) ----

  app.get("/health", async () => ({
    ok: true,
    mode: config.fixtureMode ? "fixture" : "live",
  }));

  app.get("/users", async () => users());

  app.get("/containers", async () => {
    const us = await users();
    return listContainers({ users: us, dockerBin: config.dockerBin });
  });

  app.get("/containers/:user/:name/logs", async (req, reply) => {
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

  app.get("/containers/:user/:name/stats", async (req, reply) => {
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

  app.get("/containers/:user/:name/logs/stream", async (req, reply) => {
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

  app.post("/provision", async (req, reply) => {
    const { domain, user: userName } = req.body ?? {};
    if (!config.provisionScript) {
      return reply
        .code(500)
        .send({ error: "PROVISION_SCRIPT is not configured on the agent" });
    }
    if (
      typeof domain !== "string" ||
      !domain ||
      domain.length > 253 ||
      /\s|\//.test(domain)
    ) {
      return reply.code(422).send({ error: "invalid domain" });
    }
    const us = await users();
    const user = us.find((u) => u.name === userName);
    if (!user) return reply.code(422).send({ error: "unknown user" });

    const r = await provision({
      script: config.provisionScript,
      domain,
      user: user.name,
    });
    return r; // { code, output, timedOut } — the caller decides persistence
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: "not found" }),
  );

  return app;
}