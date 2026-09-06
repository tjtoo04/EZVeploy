import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * JSON-backed domain registry (spec: Domain store).
 * Only successfully provisioned domains are persisted; the persisted list is
 * also the dedupe source. Atomic writes (tmp + rename).
 *
 * Concurrency: `reserve` checks the persisted list AND the in-memory in-flight
 * set inside one synchronous block, so two concurrent POSTs for the same
 * domain can never both pass. Call `release` in a finally after the script.
 */
export function createDomainStore(dbPath) {
  const inFlight = new Set();

  async function load() {
    try {
      const text = await readFile(dbPath, "utf8");
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function save(list) {
    await mkdir(dirname(dbPath), { recursive: true });
    const tmp = dbPath + ".tmp";
    await writeFile(tmp, JSON.stringify(list, null, 2) + "\n", "utf8");
    await rename(tmp, dbPath);
  }

  return {
    async list() {
      return load();
    },

    /** @returns {Promise<'ok'|'duplicate'|'in-flight'>} */
    async reserve(domain) {
      const list = await load();
      if (list.some((r) => r.domain === domain)) return "duplicate";
      if (inFlight.has(domain)) return "in-flight";
      inFlight.add(domain);
      return "ok";
    },

    async commit(record) {
      const list = await load();
      if (!list.some((r) => r.domain === record.domain)) list.push(record);
      await save(list);
    },

    release(domain) {
      inFlight.delete(domain);
    },

    makeRecord({ domain, user, lastResult }) {
      return {
        id: randomUUID(),
        domain,
        user,
        createdAt: new Date().toISOString(),
        lastResult,
      };
    },
  };
}
