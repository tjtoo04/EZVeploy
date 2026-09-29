import { exec, streamLines } from "./exec.js";
import { dockerHostArgv } from "./daemons.js";

/** Docker's own container-name shape — no slashes, no spaces. */
export const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function isContainerError(stderr) {
  return /[Nn]o such container/.test(stderr) || /[Nn]ot found/.test(stderr);
}

export async function logs({ user, name, lines, dockerBin, execFn = exec }) {
  const argv = [
    ...dockerHostArgv(user, dockerBin),
    "logs",
    "--tail",
    String(lines),
    name,
  ];
  const r = await execFn(argv, { timeoutMs: 15_000 });
  if (r.code !== 0) {
    if (isContainerError(r.stderr || r.stdout)) return { error: "not-found" };
    return { error: "daemon", stderr: r.stderr.trim() || "docker logs failed" };
  }
  return { text: r.stdout };
}

export async function stats({ user, name, dockerBin, execFn = exec }) {
  const argv = [
    ...dockerHostArgv(user, dockerBin),
    "stats",
    "--no-stream",
    "--format",
    "json",
    name,
  ];
  const r = await execFn(argv, { timeoutMs: 15_000 });
  if (r.code !== 0) {
    if (isContainerError(r.stderr || r.stdout)) return { error: "not-found" };
    return {
      error: "daemon",
      stderr: r.stderr.trim() || "docker stats failed",
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { error: "daemon", stderr: "unparseable docker stats output" };
  }
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  return {
    cpu: parsePct(row?.["CPU %"]),
    memUsed: row?.["MEM USAGE"] ?? "",
    memLimit: row?.["MEM LIMIT"] ?? "",
    memPct: parsePct(row?.["MEM %"]),
    netIo: row?.["NET I/O"] ?? "",
  };
}

function parsePct(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.endsWith("%")) {
    const n = Number.parseFloat?.(v) ?? Number(v.slice(0, -1));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Follow a container's logs live; lines arrive via `onLine`. */
export function followLogs({ user, name, lines, dockerBin }, onLine) {
  const argv = [
    ...dockerHostArgv(user, dockerBin),
    "logs",
    "-f",
    "--tail",
    String(lines),
    name,
  ];
  return streamLines(argv, onLine);
}
