import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, authHeaders } from "./helpers.js";

test("GET /api/users → the agent's user list, passed through", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/users",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.json().map((u) => u.name),
    ["alice", "bob", "carol", "root"],
  );
});

test("GET /api/containers → agent's { containers, daemons } passed through", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/containers",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  const { containers, daemons } = res.json();

  assert.deepEqual(
    daemons.sort((a, b) => a.user.localeCompare(b.user)),
    [
      { user: "alice", state: "up" },
      { user: "bob", state: "up" },
      { user: "carol", state: "down" },
      { user: "root", state: "up" },
    ],
  );

  const pairs = containers.map((c) => `${c.user}/${c.name}`);
  assert.equal(new Set(pairs).size, pairs.length, "user/name pairs unique");
  assert.ok(pairs.includes("alice/web"));
  assert.ok(pairs.includes("root/captain"));
});

test("GET logs → 200 text relayed from the agent", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/logs",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] ?? "", /text\/plain/);
  assert.match(res.body, /started container/);
});

test("GET logs → 404 relayed for a missing container", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/nope/logs",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "container not found");
});

test("GET logs → 404 locally for unknown user / invalid name", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  for (const url of [
    "/api/containers/ghost/web/logs",
    "/api/containers/alice/..%2Fetc%2Fpasswd/logs",
  ]) {
    const res = await app.inject({
      method: "GET",
      url,
      headers: authHeaders,
    });
    assert.equal(res.statusCode, 404, url);
  }
});

test("GET stats → parsed snapshot relayed; 404 for missing container", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const ok = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/stats",
    headers: authHeaders,
  });
  assert.equal(ok.statusCode, 200);
  const s = ok.json();
  assert.equal(s.cpu, 0.42);
  assert.equal(s.memPct, 0.32);

  const miss = await app.inject({
    method: "GET",
    url: "/api/containers/alice/nope/stats",
    headers: authHeaders,
  });
  assert.equal(miss.statusCode, 404);
});

test("SSE stream → agent frames relayed to the client", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/logs/stream",
    headers: authHeaders,
  });
  assert.match(res.headers["content-type"] ?? "", /text\/event-stream/);
  assert.match(res.body, /event: log/);
  assert.match(res.body, /followed line four/);
});

test("SSE stream → error frame relayed for a missing container", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/nope/logs/stream",
    headers: authHeaders,
  });
  assert.match(res.headers["content-type"] ?? "", /text\/event-stream/);
  assert.match(res.body, /event: error/);
  assert.match(res.body, /No such container/);
});

test("agent down → 502 on data routes, health reports agent: down", async (t) => {
  const { app, close } = await makeApp({ agentUrl: "http://127.0.0.1:1" });
  t.after(close);

  const health = await app.inject({
    method: "GET",
    url: "/api/health",
    headers: authHeaders,
  });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    ok: true,
    mode: "unknown",
    agent: "down",
  });

  for (const url of ["/api/users", "/api/containers"]) {
    const res = await app.inject({
      method: "GET",
      url,
      headers: authHeaders,
    });
    assert.equal(res.statusCode, 502, url);
  }
});