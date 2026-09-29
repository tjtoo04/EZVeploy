import { exec } from "./exec.js";

/**
 * Run the VPS provisioning script: `bash <script> <domain> <user>`.
 * argv array, never a shell string; ~60s hard timeout (child killed on
 * expiry). The caller (API server) decides persistence from `code`.
 */
export async function provision({
  script,
  domain,
  user,
  timeoutMs = 60_000,
}) {
  const r = await exec(["bash", script, domain, user], { timeoutMs });
  const output =
    r.stdout.trim() ||
    (r.timedOut ? "timed out after 60s" : r.stderr.trim());
  return { code: r.code, output, timedOut: r.timedOut };
}