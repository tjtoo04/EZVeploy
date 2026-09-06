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

test("POST /api/domains → 201 persists a record; GET lists it", async () => {
  const app = await makeApp();
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
  assert.ok(
    rec.lastResult.startsWith("provisioned shop.example for alice"),
    rec.lastResult,
  );

  const list = await app.inject({
    method: "GET",
    url: "/api/domains",
    headers: authHeaders,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].id, rec.id);
});

test("POST duplicate domain → 409", async () => {
  const app = await makeApp();
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

test("POST invalid domain → 422", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "not a domain", user: "alice" },
  });
  assert.equal(res.statusCode, 422);
});

test("POST unknown user → 422", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "x.example", user: "ghost" },
  });
  assert.equal(res.statusCode, 422);
  // blocklisted users are not assignable either
  const blocked = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "y.example", user: "mallory" },
  });
  assert.equal(blocked.statusCode, 422);
});

test("script failure → 500 with output, nothing persisted", async () => {
  const app = await makeApp();
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
    assert.match(body.output, /provisioned fail\.example for carol/); // argv order proof
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

test("unconfigured script → 500 with clear message", async () => {
  const app = await makeApp({ provisionScript: "" });
  const res = await app.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "x.example", user: "alice" },
  });
  assert.equal(res.statusCode, 500);
  assert.match(res.json().error, /PROVISION_SCRIPT/);
});

test("domains persist across app restarts (same DATA_DIR)", async () => {
  const tmp = await mkdtemp("/tmp/ezveploy-test-");
  const app1 = await makeApp({ dataDir: tmp });
  const first = await app1.inject({
    method: "POST",
    url: "/api/domains",
    headers: authHeaders,
    payload: { domain: "persist.example", user: "bob" },
  });
  assert.equal(first.statusCode, 201);

  const app2 = await makeApp({ dataDir: tmp });
  const list = await app2.inject({
    method: "GET",
    url: "/api/domains",
    headers: authHeaders,
  });
  assert.equal(list.json().length, 1);
  assert.equal(list.json()[0].domain, "persist.example");
});
