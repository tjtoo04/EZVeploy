import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, authHeaders } from "./helpers.js";

function post(app, payload) {
  return app.inject({
    method: "POST",
    url: "/provision",
    headers: authHeaders,
    payload,
  });
}

test("POST /provision → 200 { code: 0 } with argv-order output", async () => {
  const app = makeApp();
  const res = await post(app, { domain: "shop.example", user: "alice" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.code, 0);
  assert.equal(body.timedOut, false);
  // the fixture script echoes its argv — proves the exact argument order
  assert.equal(body.output, "provisioned shop.example for alice");
});

test("script failure → code 1 with output, per EZ_PROVISION_EXIT", async () => {
  const app = makeApp();
  const old = process.env.EZ_PROVISION_EXIT;
  process.env.EZ_PROVISION_EXIT = "1";
  try {
    const res = await post(app, { domain: "fail.example", user: "carol" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.code, 1);
    assert.equal(body.output, "provisioned fail.example for carol");
  } finally {
    if (old === undefined) delete process.env.EZ_PROVISION_EXIT;
    else process.env.EZ_PROVISION_EXIT = old;
  }
});

test("unknown user → 422", async () => {
  const app = makeApp();
  const res = await post(app, { domain: "x.example", user: "ghost" });
  assert.equal(res.statusCode, 422);
});

test("blocklisted user → 422", async () => {
  const app = makeApp();
  const res = await post(app, { domain: "x.example", user: "mallory" });
  assert.equal(res.statusCode, 422);
});

test("invalid domain → 422", async () => {
  const app = makeApp();
  const res = await post(app, { domain: "bad / domain", user: "alice" });
  assert.equal(res.statusCode, 422);
});

test("unconfigured script → 500 with a clear message", async () => {
  const app = makeApp({ provisionScript: "" });
  const res = await post(app, { domain: "x.example", user: "alice" });
  assert.equal(res.statusCode, 500);
  assert.match(res.json().error, /PROVISION_SCRIPT/);
});