import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, authHeaders } from "./helpers.js";

test("GET logs → 200 text for a known container", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/logs",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] ?? "", /text\/plain/);
  assert.match(res.body, /started container/);
});

test("GET logs → 404 for a missing container (daemon up)", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/nope/logs",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "container not found");
});

test("GET logs → 404 for unknown user", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/ghost/web/logs",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 404);
});

test("GET logs → 404 for an invalid container name (traversal shape)", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/..%2Fetc%2Fpasswd/logs",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 404);
});

test("GET stats → 200 with parsed numeric CPU/MEM", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/stats",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  const s = res.json();
  assert.equal(s.cpu, 0.42);
  assert.equal(s.memPct, 0.32);
  assert.equal(s.memUsed, "12.5 MiB");
});

test("GET stats → 404 for missing container", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/nope/stats",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 404);
});

test("logs lines=N is clamped to [1, 2000]", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/logs?lines=999999",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
});

test("SSE stream → error event for missing container, then closes", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/nope/logs/stream",
    headers: authHeaders,
  });
  assert.match(res.headers["content-type"] ?? "", /text\/event-stream/);
  assert.match(res.body, /event: error/);
  assert.match(res.body, /No such container/);
});

test("SSE stream → log events for a live container", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/containers/alice/web/logs/stream",
    headers: authHeaders,
  });
  assert.match(res.headers["content-type"] ?? "", /text\/event-stream/);
  assert.match(res.body, /event: log/);
  assert.match(res.body, /followed line four/);
});
