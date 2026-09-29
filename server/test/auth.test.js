import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeApp, AUTH, authHeaders } from "./helpers.js";

test("GET /api/health → 401 without credentials", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 401);
  assert.match(res.headers["www-authenticate"] ?? "", /Basic/);
});

test("GET /api/health → 401 with wrong credentials", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/health",
    headers: {
      authorization: "Basic " + Buffer.from("admin:wrong").toString("base64"),
    },
  });
  assert.equal(res.statusCode, 401);
});

test("GET /api/health → 200 with valid credentials; mode comes from the agent", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "GET",
    url: "/api/health",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, "fixture");
  assert.equal(body.agent, "ok");
});

test("static UI route is also behind auth when uiDist is set", async (t) => {
  const dist = await mkdtemp("/tmp/ezveploy-dist-");
  await writeFile(join(dist, "index.html"), "<!doctype html><title>x</title>");
  const { app, close } = await makeApp({ uiDist: dist });
  t.after(close);
  const denied = await app.inject({ method: "GET", url: "/" });
  assert.equal(denied.statusCode, 401);
  const allowed = await app.inject({
    method: "GET",
    url: "/",
    headers: authHeaders,
  });
  assert.equal(allowed.statusCode, 200);
  assert.match(allowed.body, /<title>x<\/title>/);
});

test("AUTH constant matches config", () => {
  assert.equal(AUTH, "Basic " + Buffer.from("admin:secret").toString("base64"));
});