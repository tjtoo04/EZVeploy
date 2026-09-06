import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();

// In production the built UI lives at ui/dist and is served by this server.
const uiDist = resolve(import.meta.dirname, "../../ui/dist");
config.uiDist = existsSync(uiDist) ? uiDist : null;

// Long-running headless daemon — journald captures stderr/stdout alike, so the
// console API is the logger here.
const log = (...args) => console.error(...args);

if (!config.adminPassword || config.adminPassword === "change-me") {
  log("⚠  ADMIN_PASSWORD is unset or the default — refusing to listen.");
  process.exit(1);
}

const app = buildApp(config);

app.listen({ host: config.host, port: config.port }, (err) => {
  if (err) {
    log(err.message);
    process.exit(1);
  }
  log(`EZVeploy listening on http://${config.host}:${config.port}`);
});
