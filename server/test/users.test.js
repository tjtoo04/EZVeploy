import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseUsers } from "../src/lib/users.js";
import { socketPathFor } from "../src/lib/daemons.js";
import { makeApp, FIXTURES, authHeaders } from "./helpers.js";

test("parseUsers: filters by uid >= 1000, /home/ home, blocklist; keeps root", async () => {
  const text = await readFile(`${FIXTURES}passwd`, "utf8");
  const users = parseUsers(text, { blocklist: ["mallory"] });
  assert.deepEqual(
    users.map((u) => u.name),
    ["alice", "bob", "carol", "root"], // sorted, blocklisted + non-/home filtered out
  );
  assert.deepEqual(
    users.map((u) => u.uid),
    [1001, 1002, 1003, 0],
  );
  const root = users.find((u) => u.name === "root");
  assert.equal(root.root, true);
});

test("socketPathFor: root → system socket, tenants → per-uid rootless socket", () => {
  assert.equal(socketPathFor({ root: true, uid: 0 }), "/var/run/docker.sock");
  assert.equal(
    socketPathFor({ root: false, uid: 1001 }),
    "/run/user/1001/docker.sock",
  );
});

test("GET /api/users → the fixture user list", async () => {
  const app = await makeApp();
  const res = await app.inject({
    method: "GET",
    url: "/api/users",
    headers: authHeaders,
  });
  assert.equal(res.statusCode, 200);
  const names = res.json().map((u) => u.name);
  assert.deepEqual(names, ["alice", "bob", "carol", "root"]);
});
