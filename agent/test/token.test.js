import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, AGENT_TOKEN, authHeaders } from "./helpers.js";

test("every route → 401 without the token", async () => {
  const app = makeApp();
  for (const url of ["/health", "/users", "/containers", "/provision"]) {
    const res = await app.inject({
      method: url === "/provision" ? "POST" : "GET",
      url,
    });
    assert.equal(res.statusCode, 401, url);
    assert.equal(res.json().error, "unauthorized", url);
  }
});

test("401 with a wrong token", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/health",
    headers: { authorization: "Bearer nope" },
  });
  assert.equal(res.statusCode, 401);
});

test("200 with the right token", async () => {
  const app = makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/health",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().mode, "fixture");
});

test("no token configured → rejects everything", async () => {
  const app = makeApp({ agentToken: "" });
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 401);
});

test("AGENT_TOKEN constant matches config", () => {
  assert.equal(AGENT_TOKEN, "test-token");
});