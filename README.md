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
server/   Fastify 5 API (runs as root, executes OS commands)
ui/       Vue 3 + PrimeVue 4
tools/    headless-verify helpers (shot-proxy, WebDriver drivers)
```

The API runs on one port, serves the built UI, and speaks Basic auth — no CORS,
one process, one reverse-proxy target in production.

---

## Quickstart (dev)

```bash
# backend against the test fixtures (real-looking daemons, no docker needed)
cd server
DOCKER_BIN=test/fixtures/docker \
PASSWD_FILE=test/fixtures/passwd \
PROVISION_SCRIPT=test/fixtures/provision-domain.sh \
ADMIN_USER=admin ADMIN_PASSWORD=secret PORT=3900 DATA_DIR=./data-dev \
node src/index.js

# frontend (another terminal)
cd ui && npm install && npm run dev      # → http://localhost:5173 (admin/secret)
```

Vite proxies `/api` to the Fastify server. `tools/shot-proxy.mjs` + `tools/shot.py`
render the pages in headless chromium for visual checks.

### Tests

```bash
npm test          # server: 28 tests, node:test, no extra framework
```

Tests use **fixtures for the OS seam** (SPEC, Testing Decisions): `DOCKER_BIN`
and `PROVISION_SCRIPT` point at scripts that simulate per-user daemons and a
provisioning script, asserting the exact argv the server passes.

---

## Deploying on the VPS (root)

Requirements: Node ≥ 22, the `docker` CLI, one provisioned domain for the panel.

```bash
# 1. get the code
cd /opt && git clone <your-repo-url> ezveploy && cd ezveploy

# 2. build the UI, then copy the env file
cd ui && npm install && npm run build
cd .. && cp .env.example server/.env

# 3. SYSTEMD UNIT — the only files you edit on the box
```

`/etc/systemd/system/ezveploy.service`:

```ini
[Unit]
Description=EZVeploy admin panel
After=docker.service network.target

[Service]
Type=simple
WorkingDirectory=/opt/ezveploy/server
EnvironmentFile=/opt/ezveploy/server/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now ezveploy
```

### Where to edit on the VPS (exactly two things)

1. **`/opt/ezveploy/server/.env`** — `ADMIN_USER` / `ADMIN_PASSWORD`
   (`openssl rand -base64 24`), and `PROVISION_SCRIPT` pointing at your script.
2. **The provisioning script itself** (e.g. `/opt/ezveploy/provision-domain.sh`)
   — owned by you, written by you, **never shipped in this repo**.

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

Keep `HOST=127.0.0.1`. Put a TLS reverse proxy in front (nginx/caddy) that
terminates HTTPS and proxies to `127.0.0.1:3900`. The panel's auth is HTTP
Basic, handled by the browser — the proxy must **not** add its own auth.

---

## How it works

- **Users** — one source of truth: `/etc/passwd` (`uid ≥ 1000`, home under
  `/home/`, `USER_BLOCKLIST` to hide tenants). Root is always present as the
  panel's own "admin" group.
- **Containers** — for each user, `docker --host unix:///run/user/<uid>/docker.sock ps
  --format "{{json .}}"` (root can address any user's rootless socket). Root's
  own daemon is `/var/run/docker.sock`. A failed ps = "daemon down".
  Container names are **not unique across daemons** — every reference carries
  its user (`/containers/:user/:name`).
- **Observability** — `docker logs --tail N` (200/2000 caps), SSE live-follow
  (`docker logs -f`) with client-disconnect kill + 1s reconnect, and one-shot
  `docker stats --no-stream --format json` snapshots. No metrics history.
- **Domains** — JSON registry (`DATA_DIR/domains.json`, atomic writes),
  deduplicated against stored + in-flight names. Validation is strict and
  mirrored client-side; every command runs as an **argv array**, never a shell
  string.
- **Auth** — HTTP Basic (constant-time compare) on every route including
  static assets, so the browser's native credential prompt handles login and
  `fetch`/`EventSource` inherit it automatically.

## Security notes

- Runs as root: keep it localhost-only behind TLS, give the password real
  entropy, and treat the provisioning script as the **only** command surface.
- No shell ever receives user input: usernames are allowlisted from passwd,
  container names match Docker's own `[A-Za-z0-9][A-Za-z0-9_.-]*` shape, and
  domains pass a strict regex before touching the script.

## Out of scope (deliberately)

Container start/stop/exec, metrics history/graphing, multi-container log
aggregation, user CRUD, RBAC, TLS termination in this repo, the provisioning
script itself. (Full list with rationale: `SPEC.md` — "Out of Scope".)
