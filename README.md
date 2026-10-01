# EZVeploy

A root admin panel for a multi-tenant VPS that hosts **rootless Docker** tenants
(per the edgectl model: one per-user daemon, per-tenant edge nginx, domains
mapped at the front proxy).

Three pages, no SSH required:

- **Containers** — every running container across every tenant's daemon,
  grouped by owner; a per-tenant shelf shows daemon state, so a down daemon is
  visible, not silently missing.
- **Observability** — per-container `/containers/:user/:name`: log tail, live
  SSE follow with reconnect, and a CPU/memory snapshot.
- **Add Domain** — provision a domain to a tenant by running the VPS-side
  provisioning script; the registry is persisted and deduplicated.

```
agent/    the VPS agent — the ONLY process that touches the OS (docker daemons,
          /etc/passwd, the provisioning script). Runs as root on 127.0.0.1:3901.
server/   the API gateway — Basic auth, domain registry, the built UI. Never
          runs an OS command; talks to the agent over localhost. 127.0.0.1:3900.
ui/       Vue 3 + PrimeVue 4
tools/    headless-verify helpers (shot-proxy, WebDriver drivers)
```

Two processes, one trust boundary: the browser talks to `server` (Basic auth),
`server` talks to `agent` (Bearer token, `http://127.0.0.1:3901`), and only
`agent` talks to the OS. Nothing is containerized — the agent runs bare on the
box because it has to see `/etc/passwd`, the per-user docker sockets, and the
provisioning script's side effects (nginx configs, certs).

---

## Quickstart (dev)

Three processes, three terminals:

```bash
# terminal 1 — the VPS agent against the test fixtures (real-looking daemons,
# no docker needed). Fixture mode shows a "fixture data" tag in the UI.
cd agent
DOCKER_BIN=test/fixtures/docker \
PASSWD_FILE=test/fixtures/passwd \
PROVISION_SCRIPT=test/fixtures/provision-domain.sh \
AGENT_TOKEN=dev-token \
node src/index.js                       # → http://127.0.0.1:3901

# terminal 2 — the API server (gateway)
cd server
AGENT_URL=http://127.0.0.1:3901 AGENT_TOKEN=dev-token \
ADMIN_USER=admin ADMIN_PASSWORD=secret PORT=3900 DATA_DIR=./data-dev \
node src/index.js                       # → http://127.0.0.1:3900

# terminal 3 — the frontend
cd ui && npm install && npm run dev     # → http://localhost:5173 (admin/secret)
```

Vite proxies `/api` to the Fastify server. `tools/shot-proxy.mjs` + `tools/shot.py`
render the pages in headless chromium for visual checks.

### Tests

```bash
npm test          # both suites: agent (OS seam via fixtures) + server (fake agent, hermetic)
```

- **agent** — the OS-level tests: passwd filtering, per-user daemon states,
  container listing, logs/stats/SSE, provisioning argv order, token auth.
  Uses the fixture seam (`DOCKER_BIN`, `PASSWD_FILE`, `PROVISION_SCRIPT`).
- **server** — the gateway tests: Basic auth, domain validation/dedupe/
  persistence, and proxying against an in-process fake agent (no OS calls).

---

## Deploying on the VPS (root)

Requirements: Node ≥ 22 with npm, installed system-wide (the systemd units
below expect `/usr/bin/node`), the `docker` CLI on the host (the agent shells
out to it), and one provisioned domain for the panel.

```bash
# 1. get the code (as root → /root/EZVeploy)
cd ~ && git clone <your-repo-url> EZVeploy && cd EZVeploy

# 2. install all workspaces (agent, server, ui), build the UI,
#    then create the two env files
npm ci
npm run build
cp server/.env.example server/.env     # → /root/EZVeploy/server/.env
cp agent/.env.example agent/.env       # → /root/EZVeploy/agent/.env
chmod 600 server/.env agent/.env
```

The agent and server are plain JS — no build step, they only need `npm ci`.
Only the UI is built (Vite).

### Where the .env files go (exactly two, plus the script)

| File | Holds |
|------|-------|
| **`/root/EZVeploy/server/.env`** | `ADMIN_USER` / `ADMIN_PASSWORD` (browser login), `AGENT_URL` / `AGENT_TOKEN` |
| **`/root/EZVeploy/agent/.env`** | `AGENT_TOKEN` (**same value as server's**), `PROVISION_SCRIPT`, `USER_BLOCKLIST` |
| the provisioning script itself | e.g. `/opt/ezveploy/provision-domain.sh` — owned by you, **never shipped** |

Generate both tokens with `openssl rand -base64 24`. `AGENT_TOKEN` must be
identical in the two files — it is how the server proves itself to the agent.

> **Moving from the single-server setup:** `server/.env` loses
> `PROVISION_SCRIPT`, `USER_BLOCKLIST`, `DOCKER_BIN`, `PASSWD_FILE` (those now
> live in `agent/.env`); add `AGENT_URL` and `AGENT_TOKEN`. Then create
> `agent/.env` from `agent/.env.example` and set `AGENT_TOKEN`, `PROVISION_SCRIPT`,
> `USER_BLOCKLIST`.

### SYSTEMD UNITS — agent first, then the server

systemd does not expand `~`, so the units use absolute paths. `ExecStart`
must match `which node` on your box.

`/etc/systemd/system/ezveploy-agent.service`:

```ini
[Unit]
Description=EZVeploy VPS agent
After=docker.service network.target

[Service]
Type=simple
WorkingDirectory=/root/EZVeploy/agent
EnvironmentFile=/root/EZVeploy/agent/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/ezveploy.service`:

```ini
[Unit]
Description=EZVeploy admin panel
After=ezveploy-agent.service network.target
Requires=ezveploy-agent.service

[Service]
Type=simple
WorkingDirectory=/root/EZVeploy/server
EnvironmentFile=/root/EZVeploy/server/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now ezveploy-agent ezveploy
```

The server starts before the agent, requests simply get a 502 (and a
"reconnecting" state in the UI) until the agent answers — it restarts on its
own, no wiring needed.

### Provisioning script contract

```bash
#!/usr/bin/env bash
set -euo pipefail
# $1 = normalized domain (lowercase, no scheme/trailing dot; *. wildcard allowed)
# $2 = tenant username (allowlisted from /etc/passwd — never treat as shell)
echo "imported <domain> → <user>"      # stdout = the summary shown in the UI
```

- exit `0` = success (the domain is persisted in the registry)
- non-zero = failure (stdout/stderr returned to the UI, nothing persisted)
- ~60s hard timeout, child killed on expiry
- The script maps `<domain> → <user>`'s edge port at the front proxy
  (the admin half of the edgectl flow). The panel never touches docker, nginx,
  or DNS — the script is the entire extension point.

### Exposing it

Keep `HOST=127.0.0.1` on **both** servers. Put a TLS reverse proxy in front
(nginx/caddy) that terminates HTTPS and proxies to `127.0.0.1:3900`. The
panel's auth is HTTP Basic, handled by the browser — the proxy must **not**
add its own auth.

---

## How it works

- **Two servers, one boundary.** `agent/` owns `/etc/passwd` (users, `uid ≥
  1000`, home under `/home/`, `USER_BLOCKLIST`; root is always present as the
  panel's own "admin" group), the per-user daemon sockets, `docker ps`, and
  every logs/stats/stream command. `server/` owns the browser-facing API —
  Basic auth on every route including static assets — and the domain registry.
  The server never runs a command; it calls the agent's REST API with a Bearer
  token and validates every user/name against the agent's allowlist first.
- **Containers** — for each user, the agent runs `docker --host
  unix:///run/user/<uid>/docker.sock ps --format "{{json .}}"` (root can
  address any user's rootless socket). Root's own daemon is
  `/var/run/docker.sock`. A failed ps = "daemon down". Container names are
  **not unique across daemons** — every reference carries its user
  (`/containers/:user/:name`).
- **Observability** — agent-side `docker logs --tail N` (200/2000 caps), SSE
  live-follow (`docker logs -f`) with client-disconnect kill + 1s reconnect,
  and one-shot `docker stats --no-stream --format json` snapshots. The server
  proxies the SSE stream through the same `/api/...` URL, so the UI's
  `EventSource` never knows the agent exists. No metrics history.
- **Domains** — JSON registry (`DATA_DIR/domains.json`, atomic writes) in the
  server; deduplicated against stored + in-flight names; the agent runs the
  script and reports `{ code, output, timedOut }`; the server persists only on
  `code 0`. Validation is strict and mirrored client-side; every command runs
  as an **argv array**, never a shell string.
- **Auth** — HTTP Basic (constant-time compare) on every server route, so the
  browser's native credential prompt handles login and `fetch`/`EventSource`
  inherit it automatically. Server → agent is a Bearer token (constant-time
  compare too), shared via the two `.env` files. The agent binds
  `127.0.0.1:3901` — it has no reason to be reachable beyond the box.

## Security notes

- Both processes run as root: keep them localhost-only behind TLS, give the
  passwords real entropy, and treat the provisioning script as the **only**
  command surface. The agent's token is the key between the two — keep it out
  of the UI at all times.
- No shell ever receives user input: usernames are allowlisted from passwd,
  container names match Docker's own `[A-Za-z0-9][A-Za-z0-9_.-]*` shape, and
  domains pass a strict regex before touching the script. The server and the
  agent each validate independently at their own boundary.

## Out of scope (deliberately)

Container start/stop/exec, metrics history/graphing, multi-container log
aggregation, user CRUD, RBAC, TLS termination in this repo, the provisioning
script itself. (Full list with rationale: `SPEC.md` — "Out of Scope".)