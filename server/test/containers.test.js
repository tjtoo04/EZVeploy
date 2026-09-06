import { test } from "node:test";
import assert from "node:assert/strict";
import { makeApp, authHeaders } from "./helpers.js";

test("GET /api/containers → per-user daemon states + containers with owner", async () => {
    const app = await makeApp();
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

    const byName = new Map(containers.map((c) => [`${c.user}/${c.name}`, c]));
    assert.ok(byName.has("alice/web"));
    assert.ok(byName.has("alice/db"));
    assert.ok(byName.has("root/captain"));

    const web = byName.get("alice/web");
    assert.equal(web.image, "nginx:1.27");
    assert.equal(web.status, "Up 3 hours");
    assert.deepEqual(web.ports, [
        { public: "8080", internal: "80", proto: "tcp" },
    ]);

    const db = byName.get("alice/db");
    assert.deepEqual(db.ports, [{ internal: "5432", proto: "tcp" }]);
});

test("GET /api/containers → container names are NOT unique across daemons", async () => {
    // Regression guard for the architecture: two tenants may both run "web".
    const app = await makeApp();
    const res = await app.inject({
        method: "GET",
        url: "/api/containers",
        headers: authHeaders,
    });
    const { containers } = res.json();
    const names = containers.map((c) => `${c.user}/${c.name}`);
    assert.equal(
        new Set(names).size,
        names.length,
        "every user/name pair must be unique",
    );
});
