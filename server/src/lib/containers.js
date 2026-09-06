import { exec } from "./exec.js";
import { dockerHostArgv } from "./daemons.js";

/**
 * List running containers across every user's rootless daemon.
 * Ownership is structural: whatever a user's daemon reports belongs to them.
 * A daemon that fails to respond (no socket / daemon down) is reported as
 * `down` rather than failing the whole listing.
 */
export async function listContainers({ users, dockerBin, execFn = exec }) {
  const containers = [];
  const daemons = [];
  for (const user of users) {
    const argv = [
      ...dockerHostArgv(user, dockerBin),
      "ps",
      "--format",
      "{{json .}}",
    ];
    const r = await execFn(argv, { timeoutMs: 10_000 });
    if (r.code !== 0) {
      daemons.push({ user: user.name, state: "down" });
      continue;
    }
    daemons.push({ user: user.name, state: "up" });
    for (const raw of r.stdout.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let c;
      try {
        c = JSON.parse(line);
      } catch {
        continue;
      }
      if (!c?.Names) continue;
      containers.push({
        id: c.ID,
        name: c.Names,
        image: c.Image,
        status: c.Status,
        ports: parsePorts(c.Ports),
        user: user.name,
      });
    }
  }
  return { containers, daemons };
}

/** "0.0.0.0:8080->80/tcp, 443/tcp" → [{ public: "8080", internal: "80", proto: "tcp" }, { internal: "443", proto: "tcp" }] */
export function parsePorts(portsStr = "") {
  const out = [];
  for (const part of portsStr.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const proto = p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : "tcp";
    const mapping = p.split("/")[0];
    if (mapping.includes("->")) {
      const [publicPart, internal] = mapping.split("->");
      out.push({
        public: publicPart.slice(publicPart.lastIndexOf(":") + 1),
        internal,
        proto,
      });
    } else {
      out.push({
        internal: mapping.slice(mapping.lastIndexOf(":") + 1),
        proto,
      });
    }
  }
  return out;
}
