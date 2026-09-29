import { readFile } from "node:fs/promises";

/**
 * The single source of truth for tenant users: /etc/passwd.
 * - root is always included (the panel's own "admin" group).
 * - regular users: uid >= 1000, home under /home/, not blocklisted.
 */
export function parseUsers(passwdText, { blocklist = [] } = {}) {
  const users = [];
  for (const line of passwdText.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(":");
    if (parts.length < 7) continue;
    const [name, , uidStr, , , home] = parts;
    const uid = Number(uidStr);
    if (!name || Number.isNaN(uid)) continue;
    if (name === "root") {
      users.push({ name, uid, home: home || "/root", root: true });
      continue;
    }
    if (
      uid >= 1000 &&
      home &&
      home.startsWith("/home/") &&
      !blocklist.includes(name)
    ) {
      users.push({ name, uid, home, root: false });
    }
  }
  users.sort((a, b) => a.name.localeCompare(b.name));
  return users;
}

export async function loadUsers(config) {
  let text;
  try {
    text = await readFile(config.passwdFile, "utf8");
  } catch {
    return [];
  }
  return parseUsers(text, { blocklist: config.userBlocklist });
}

export function findUser(users, name) {
  return users.find((u) => u.name === name);
}
