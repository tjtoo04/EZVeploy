import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { makeApp, authHeaders } from "./helpers.js";
import {
  normalizeDomain,
  validateDomain,
} from "../src/lib/domains-validate.js";

test("normalizeDomain: strips scheme, www, path, trailing dot; lowercases", () => {
  assert.equal(
    normalizeDomain("HTTPS://WWW.Example.COM/path?x=1."),
    "example.com",
  );
  assert.equal(normalizeDomain("*.shop.com"), "*.shop.com");
  assert.equal(normalizeDomain("  example.com "), "example.com");
});

test("validateDomain: accepts sane + wildcard domains, rejects garbage", () => {
  for (const good of [
    "example.com",
    "*.shop.com",
    "a-b.c-d.io",
    "localhost",
    "xn--bcher-kva.example",
  ]) {
    assert.equal(validateDomain(good), "", `expected ${good} valid`);
  }
  for (const bad of [
    "",
    "not a domain",
    "exa..mple.com",
    "-leading.example",
    "exa mple.com",
    "a".repeat(300),
  ]) {
    assert.notEqual(
      validateDomain(bad),
      "",
      `expected ${JSON.stringify(bad)} invalid`,
    );
  }
});

test("POST /api/domains → 201 persists a record; GET lists it", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "HTTPS://WWW.Shop.Example./", user: "alice" },
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.json()));
  const rec = res.json();
  assert.equal(rec.domain, "shop.example");
  assert.equal(rec.user, "alice");
  assert.equal(rec.lastResult, "provisioned shop.example for alice");
  assert.ok(rec.id);

  const list = await app.inject({
    method: "GET",
    url: "/api/domains",
    headers: authHeaders,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].id, rec.id);
});

test("POST duplicate domain → 409", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const first = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "shop.example.com", user: "alice" },
  });
  assert.equal(first.statusCode, 201);
  const dup = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "shop.example.com", user: "bob" },
  });
  assert.equal(dup.statusCode, 409);
});

test("POST invalid domain → 422", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const res = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "not a domain", user: "alice" },
  });
  assert.equal(res.statusCode, 422);
});

test("POST unknown user → 422 (incl. blocklisted, which the agent never lists)", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  for (const user of ["ghost", "mallory"]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/domains",
      headers: authHeaders,
      payload: { domain: "x.example", user },
    });
    assert.equal(res.statusCode, 422, user);
  }
});

test("script failure → 500 with output, nothing persisted", async (t) => {
  const { app, close } = await makeApp();
  t.after(close);
  const old = process.env.EZ_PROVISION_EXIT;
  process.env.EZ_PROVISION_EXIT = "1";
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/domains",
      headers: authHeaders,
      payload: { domain: "fail.example", user: "carol" },
    });
    assert.equal(res.statusCode, 500);
    const body = res.json();
    assert.equal(body.error, "provisioning failed");
    assert.equal(body.output, "provisioned fail.example for carol");
  } finally {
    if (old === undefined) delete process.env.EZ_PROVISION_EXIT;
    else process.env.EZ_PROVISION_EXIT = old;
  }
  const list = await app.inject({
    method: "GET",
    url: "/api/domains",
    headers: authHeaders,
  });
  assert.equal(list.json().length, 0);
});

test("domains persist across app restarts (same DATA_DIR)", async (t) => {
  const tmp = await mkdtemp("/tmp/ezveploy-test-");
  const first = await makeApp({ dataDir: tmp });
  t.after(first.close);
  const res = await first.app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "persist.example", user: "bob" },
  });
  assert.equal(res.statusCode, 201);

  const second = await makeApp({ dataDir: tmp });
  t.after(second.close);
  const list = await second.app.inject({
    method: "GET",
    url: "/api/domains",
    headers: authHeaders,
  });
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].domain, "persist.example");
});

test("agent down → 502, nothing persisted, reservation released", async (t) => {
  const { app, close } = await makeApp({ agentUrl: "http://127.0.0.1:1" });
  t.after(close);
  const first = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "x.example", user: "alice" },
  });
  assert.equal(first.statusCode, 502);
  // the in-flight reservation must have been released — not a 409
  const second = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "x.example", user: "alice" },
  });
  assert.equal(second.statusCode, 502);
  const list = await app.inject({
    method: "GET",
    url: "/api/domains",
    headers: authHeaders,
  });
  assert.equal(list.json().length, 0);
});