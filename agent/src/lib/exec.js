import { spawn } from "node:child_process";

/**
 * THE single OS-command seam (SPEC, Testing Decisions — seam 2).
 * Everything that executes outside this process goes through these functions.
 * Commands are always argv arrays — never shell strings.
 *
 * Built on node:child_process#spawn (argv[0] is the file, the rest are args).
 */

async function drain(stream) {
  let out = "";
  try {
    for await (const chunk of stream) out += chunk.toString("utf8");
  } catch {
    // stream closed by kill() — nothing more to read
  }
  return out;
}

/** Run a short command to completion. Returns { code, stdout, stderr, timedOut }. */
export async function exec([file, ...args], { timeoutMs = 30_000, env } = {}) {
  const child = spawn(file, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : undefined,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {
      // already reaped
    }
  }, timeoutMs);

  const stdoutP = drain(child.stdout);
  const stderrP = drain(child.stderr);
  const settled = new Promise((resolve) => child.once("close", resolve));
  const stdout = await stdoutP;
  const stderr = await stderrP;
  await settled;
  clearTimeout(timer);

  return {
    code: timedOut ? -1 : child.exitCode,
    stdout,
    stderr,
    timedOut,
  };
}

/**
 * Spawn a long-lived command, delivering stdout lines to onLine (CRLF trimmed).
 * Stderr is captured for error detection (e.g. "no such container").
 * Returns { child, done } — call child.kill() to stop; `done` resolves with
 * { code|null, stderr } once the process has settled.
 */
export function streamLines([file, ...args], onLine) {
  const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderrP = drain(child.stderr);
  let buf = "";
  const settled = new Promise((resolve) =>
    child.once("close", () => resolve(child.exitCode)),
  );

  const pump = (async () => {
    try {
      for await (const chunk of child.stdout) {
        buf += chunk.toString("utf8");
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
        }
      }
    } catch {
      // killed — stop pumping
    }
    if (buf.trim()) onLine(buf.trimEnd());
  })();

  const done = Promise.all([pump, stderrP, settled]).then(([, stderr]) => ({
    code: child.exitCode,
    stderr,
  }));

  return { child, done };
}
