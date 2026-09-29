import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token auth hook over every agent route. The API server sends
 * `Authorization: Bearer <AGENT_TOKEN>`; with no token configured the hook
 * rejects everything (secure default for a root-touching process).
 */
export function tokenHook({ agentToken }) {
  const expected = agentToken ? `Bearer ${agentToken}` : "";
  return async (req, reply) => {
    const given = req.headers.authorization || "";
    if (!expected || !safeEqual(given, expected)) {
      reply.code(401).send({ error: "unauthorized" });
    }
  };
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}