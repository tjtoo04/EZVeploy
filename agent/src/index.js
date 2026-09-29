import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

const config = loadConfig();

// Long-running headless daemon — journald captures stderr/stdout alike, so the
// console API is the logger here.
const log = (...args) => console.error(...args);

if (!config.agentToken) {
  log("⚠  AGENT_TOKEN is unset — refusing to listen.");
  process.exit(1);
}

const app = buildApp(config);

app.listen({ host: config.host, port: config.port }, (err) => {
  if (err) {
    log(err.message);
    process.exit(1);
  }
  log(`EZVeploy agent listening on http://${config.host}:${config.port}`);
});