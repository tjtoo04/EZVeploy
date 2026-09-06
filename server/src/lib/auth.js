import { timingSafeEqual } from "node:crypto";

/**
 * HTTP Basic auth hook over every route (API and static).
 * Constant-time compare of the full Authorization value against the expected
 * base64 — no dependency, and valid for the browser's native credential prompt
 * (credentials are cached per-origin and reused by fetch + EventSource).
 *
 * Returns an async Fastify onRequest hook. With no/blank config the hook is a
 * no-op so tests can exercise both worlds.
 */
export function authHook({ adminUser, adminPassword }) {
 const expected =
  "Basic " + Buffer.from(`${adminUser}:${adminPassword}`).toString("base64");
 return async (req, reply) => {
  const given = req.headers.authorization || "";
  if (!timingSafeEqualSafe(given, expected)) {
   reply
    .header("WWW-Authenticate", 'Basic realm="EZVeploy", charset="UTF-8"')
    .header("Cache-Control", "no-store")
    .code(401)
    .send("unauthorized");
  }
 };
}

function timingSafeEqualSafe(a, b) {
 const ab = Buffer.from(a, "utf8");
 const bb = Buffer.from(b, "utf8");
 if (ab.length !== bb.length) return false;
 return timingSafeEqual(ab, bb);
}
