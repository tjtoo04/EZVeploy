# Spec: VPS Admin Dashboard (EZVeploy)

## Problem Statement

The user runs a multi-tenant VPS as root, hosting other people's Docker containers and mapping domains to server users. There is currently no UI for this — every operation requires SSHing in, remembering which user owns which container, and hand-editing configs or running scripts manually.

## Solution

A small self-hosted admin dashboard on the VPS with three pages:

1. **Containers** — a live list of running Docker containers, grouped by the server user that owns them (each tenant runs **rootless Docker**, so the grouping is structural: every container lives in exactly one user's daemon). Each row links to that container's observability page.
2. **Observability** — a per-container page showing live logs and a resource snapshot.
3. **Add Domain** — a form (domain + owning-user dropdown) that runs the provisioning script on the server.

Backend is **two** Node.js/Fastify processes: an **agent** that runs as root and owns every OS-touching capability, and an **API gateway** the browser talks to, which delegates to the agent over localhost. Frontend is Vue 3 + PrimeVue.

## User Stories

### Containers

1. As an admin, I want to see all running Docker containers on one page, so that I can see at a glance what's deployed without SSHing.
2. As an admin, I want containers grouped by the user who owns them, so that I can answer "what is user X running?" immediately.
3. As an admin, I want each container row to show container name, image, status, and published ports, so that I can troubleshoot common issues from the UI.
4. As an admin, I want tenants whose rootless daemon is unreachable shown as a distinct "daemon down" state, so that I can see that someone's containers are invisible rather than silently missing.
5. As an admin, I want a manual refresh button on the container list, so that I can re-poll for current state.
6. As an admin, I want a clear error state if Docker is down or unreachable, so that I know the page isn't just stale.
7. As an admin, I want to click a container row and land on its observability page, so that I can go from overview to deep-dive in one click.

### Observability

1. As an admin, I want a page per container showing its recent logs (tail), so that I can inspect container output without SSHing.
2. As an admin, I want to follow the logs live, so that I can watch a deploy or crash unfold in real time.
3. As an admin, I want a current snapshot of the container's resource usage (CPU, memory, disk), so that I can spot a runaway container.
4. As an admin, I want the logs in a monospace, auto-scrolling view with a freeze toggle, so that I can pause at a moment without losing my place.
5. As an admin, I want a clear message if the container no longer exists or Docker is unreachable, so that I know the page state is stale rather than silently empty.

### Add Domain

1. As an admin, I want to add a domain by typing it and picking the owning user from a dropdown, so that I don't have to remember usernames.
2. As an admin, I want the dropdown to be populated from the real system users on the server, so that I can never assign a domain to a nonexistent user.
3. As an admin, I want invalid domains rejected with a clear message before any script runs, so that the provisioning script never receives garbage input.
4. As an admin, I want to see a loading state while the provisioning script runs, so that I know the request is in progress.
5. As an admin, I want to see the script's output (success or error) after provisioning, so that I can confirm it worked or see why it failed.
6. As an admin, I want provisioned domains persisted with their owner, so that ownership survives container restarts.
7. As an admin, I want to see the list of already-provisioned domains with owners, so that I don't create duplicates.
8. As an admin, I want duplicate or in-progress domain submissions rejected, so that the provisioning script can't be double-triggered for the same domain.
9. As an admin, I want the whole panel protected by authentication, so that a stranger on the network can't trigger root commands on my server.

## Implementation Decisions

**Layout** — monorepo with three packages, two processes, one port in prod:

- `agent/` — the **VPS agent** (Fastify): the only process that touches the OS. Reads `/etc/passwd`, talks to the per-user rootless docker daemon sockets, and runs the provisioning script. Binds `127.0.0.1:3901`; every route requires a Bearer token (`AGENT_TOKEN`).
- `server/` — the **API gateway** (Fastify): Basic auth, the domain registry, and — in production — the built Vue app served statically (single port). Never runs an OS command; it calls the agent's REST API over localhost. In dev, Vite proxies `/api` → server (same-origin, so **no CORS dependency at all**).
- `ui/` — Vue 3 + Vue Router + PrimeVue 4.
- The provisioning script is **NOT in this repo** — it lives on the VPS. The agent invokes whatever `PROVISION_SCRIPT` points at (see below). No docker/compose anywhere: both processes run bare on the box because the agent must see `/etc/passwd`, the docker sockets, and the script's side effects (nginx configs, certs).

**Users (single source of truth: system accounts)** — the agent's `lib/users.js` reads `/etc/passwd` (no dependency; root read is trivial), filters to `uid >= 1000` with a home under `/home/`, excludes an env configurable blocklist (`USER_BLOCKLIST`). Sorted list, exposed as `GET /users`. The server pulls this list from the agent; it feeds both the container grouping and the domain dropdown, so dropdown entries always match real server users. No user CRUD — users are OS accounts.

**Provisioning script** — lives on the VPS; configured via `PROVISION_SCRIPT` in the **agent's** `.env` (absolute path). It is the admin-side step of the edgectl flow (`40-proxy.sh` in the guide): adding a domain maps `<domain> → <user>`'s edge port at the front proxy. The script is responsible for looking up the user's fixed edge port range; the panel stays dumb. Contract: `<script> <domain> <user>`, `set -euo pipefail`, exit code 0 = success, stdout = human-readable summary. The panel never embeds or ships any script logic — it only ever invokes `${PROVISION_SCRIPT} <domain> <user>` via an argv array, capturing stdout+stderr, with a ~60s timeout (child killed on expiry). **Where to edit on the VPS: exactly two `.env` files and the script.** `agent/.env` holds `PROVISION_SCRIPT`, `AGENT_TOKEN`, `USER_BLOCKLIST`; `server/.env` holds `ADMIN_USER`/`ADMIN_PASSWORD`, `AGENT_URL`, and the **same** `AGENT_TOKEN`. The script itself is the third hand-edited artifact.

**Containers** — tenants run **rootless Docker**, one per-user daemon, per the edgectl guide on the VPS. The **agent** enumerates system users (same `/etc/passwd` source as the dropdown), and for each user whose daemon socket exists runs `docker --host unix:///run/user/<uid>/docker.sock ps --format "{{json .}}"` (running containers only, NDJSON). Ownership is structural: containers returned from user X's daemon belong to X. Doing this as root is fine — root can connect to any user's unix socket, no `sudo -u` needed. A user with no socket (daemon never started / linger disabled) yields a per-user `"daemon down"` state instead of failing the whole list; root's own daemon is included as an "admin" group. Container names are **not globally unique** across daemons (two tenants can both have `web`), so every container reference carries its user.

Raw CLI over `dockerode`: we're already root, already shelling for the script, and `docker ps --format` JSON is parseable — zero new dependencies.

**Observability** — every command is scoped to the owning user's daemon (`docker --host unix:///run/user/<uid>/docker.sock …`), so routes take `:user/:name`. These are **agent-internal** routes; the server exposes the same paths publicly as `/api/containers/:user/:name/...` and proxies them (see the API contract):

- `GET /containers/:user/:name/logs?lines=N` → `docker logs --tail N` (caps: default 200, max 2000), raw text.
- `GET /containers/:user/:name/logs/stream` → SSE live-follow: spawns `docker logs -f --tail N --since=` per client against that daemon, pipes lines as `data:` events, kills the child on client disconnect. The server proxies this stream byte-for-byte, so the UI's EventSource URL never changes. `-n` reconnect policy: client catches the close and reconnects after 1s.
- `GET /containers/:user/:name/stats` → `docker stats --no-stream --format json` snapshot (CPU%, MEM usage/limit). Single snapshot per request — no metrics history.
- Both `:user` (validated against the passwd allowlist) and `:name` (Docker's `[a-zA-Z0-9][a-zA-Z0-9_.-]*` shape) are validated — independently at **both** the server and the agent boundary — before any command; the command result distinguishes "container not found" from other failures.

**Domain store** — `lib/domains.js` (gateway-side; the agent is stateless) persists to a JSON file (`data/domains.json`, path via `DATA_DIR` env), written atomically (tmp file + rename). Single admin panel, low write volume — a full DB is unrequested weight. Records: `{ id, domain, user, createdAt, lastResult }`. Only successful provisions are persisted; the list doubles as the dedupe source. Upgrade to SQLite if it ever outgrows this.

**Add-domain flow**:

1. Normalize (trim, lowercase, strip scheme/trailing dot if pasted) and validate against strict regex (letters/digits/hyphens/dots/wildcard `*.` prefix only, no `..`, max 253 chars). Invalid → `422`.
2. User must be in the current system-users list (pulled from the agent's `GET /users`) → else `422`.
3. Already in the store → `409`; already in the in-flight set → `409`.
4. The server calls the agent's `POST /provision { domain, user }`, which executes `bash ${PROVISION_SCRIPT} <domain> <user>` — **argv array, no shell string interpolation, ever** — and returns `{ code, output, timedOut }`. Exit 0 → the server persists the record + `201` with trimmed stdout; non-zero → `500` with output; agent unreachable → `502` and the reservation is released. Timeout ~60s (kill the child).

**Security (non-negotiable, this runs as root)**:

- Basic auth on all gateway routes: `ADMIN_USER`/`ADMIN_PASSWORD` env, constant-time compare, custom hook — no auth dependency needed. The browser never sees the agent.
- **Gateway → agent**: the server is the agent's only caller. The agent requires `Authorization: Bearer <AGENT_TOKEN>` (constant-time compare) on every route and binds `127.0.0.1:3901`; the two processes share the token via `AGENT_TOKEN` in both `.env` files.
- Bind to `127.0.0.1` by default (env overridable); TLS/reverse-proxy is the user's job (noted, not built).
- All user input validated at the API boundary (422) and re-checked at the agent boundary; commands run via argv arrays only. The passwd allowlist is an explicit anti-injection device: no username string ever reaches a shell. Container names in observability routes are validated against the same `[a-zA-Z0-9][a-zA-Z0-9_.-]*` shape Docker itself accepts (no slashes/spaces).

**API contract**:

- `GET /api/users` → `[ { name, uid, home } ]`
- `GET /api/containers` → `[ { id, name, image, status, ports, user } ]` + per-user daemon state `[ { name, daemon: "up" | "down" } ]` (grouped client-side)
- `GET /api/containers/:user/:name/logs?lines=N` → `200` text | `404` unknown container/daemon
- `GET /api/containers/:user/:name/logs/stream` → SSE `text/event-stream`
- `GET /api/containers/:user/:name/stats` → `200` JSON | `404` unknown container/daemon
- `POST /api/domains` `{ domain, user }` → `201 { id, domain, user, createdAt, lastResult }` | `409` dup | `422` invalid | `500` script failure `{ error, output }`
- `GET /api/domains` → `[ { id, domain, user, createdAt, lastResult } ]`

**Internal agent API** (server → agent, Bearer token, `http://127.0.0.1:3901`):

- `GET /health` → `{ ok, mode }` — mode `fixture` | `live` feeds the gateway's `/api/health`
- `GET /users` → `[ { name, uid, home } ]`
- `GET /containers` → `{ containers, daemons }` (the public payload, passed through)
- `GET /containers/:user/:name/logs?lines=N` | `/stats` | `/logs/stream` → text / JSON / SSE (proxied)
- `POST /provision` `{ domain, user }` → `{ code, output, timedOut }` — the outcome as data, not HTTP status; the gateway decides persistence

**Frontend** — PrimeVue: `TabMenu` (Containers / Add Domain) + router route `/containers/:user/:name` for observability. Containers page: `DataTable` with `rowGroupMode="subheader"` grouping by owner, `Tag` for status, row click → `/containers/:user/:name`. Observability page: `Tag`-style stat cards (CPU%, MEM), monospace log viewport with auto-scroll + freeze toggle, follow button (switches to the SSE stream). Add Domain page: `Dropdown` + `InputText` + `Button`, spinner-on-button while provisioning, `Toast` for results, separate `DataTable` of provisioned domains. Validation rules mirrored client-side with server messages shown via `InlineMessage`.

**Config env** (split across two files):

- `server/.env` — `HOST`, `PORT` (3900), `ADMIN_USER`, `ADMIN_PASSWORD`, `DATA_DIR`, `AGENT_URL` (default `http://127.0.0.1:3901`), `AGENT_TOKEN`.
- `agent/.env` — `HOST`, `PORT` (3901), `AGENT_TOKEN` (same value as the server's), `PROVISION_SCRIPT`, `USER_BLOCKLIST`, plus the test/fixture overrides `DOCKER_BIN`, `PASSWD_FILE`.

## Testing Decisions

- **A good test asserts HTTP behavior and the argv contract, not script internals.**
- **Seam 1 — HTTP:** Fastify's built-in `app.inject()` (no sockets). Covers auth `401`s, validation `422`s, dedupe `409`s, `404` unknown container, and the `201`/`500` paths.
- **Seam 2 — OS commands:** all external command execution goes through one thin `lib/exec.js` wrapper in the **agent**, and the `DOCKER_BIN` env var lets tests point "docker" at a fixture script (`test/fixtures/docker`). The fixture keys its output off the `--host` argument, so per-user daemon behavior (container lists, "not found", `docker logs`/`docker stats`) is simulated per socket path. `PROVISION_SCRIPT` likewise points at a fixture script (`test/fixtures/provision-domain.sh`) that echoes its args and exits per mode. This covers the real runner + correct argv (`--host` + command) passing — the security-relevant behavior — without touching docker, the network, or the real script. The SSE stream endpoint is tested by reading the fixture's emitted lines from `app.inject()`'s response body.

**Two suites:** the OS-seam tests above live in `agent/test/`; `server/test/` is hermetic — it runs against an in-process **fake agent** (a canned HTTP stand-in) and covers gateway behavior: auth, domain validation/dedupe/persistence, proxy/status mapping (404 ↔ 502), SSE relay, and agent-down → `502` with the domain reservation released.
- Runner: Node's built-in `node --test` (no test framework dependency). Prior art: none — greenfield, these tests are the first.

## Out of Scope

- Multi-admin/RBAC, audit logs, per-user logins
- Container start/stop/restart/exec from the UI — read-only list + logs
- Metrics history / graphing / Grafana-style observability (snapshots + live logs only)
- Multi-container log aggregation or log search/saving
- Auto-refresh/polling of the container list (manual refresh only)
- HTTPS termination / reverse-proxy setup (documented, not built)
- DNS management, SSL issuance, or any provisioning logic — the VPS-side script is entirely the user's, invoked by contract
- The provisioning script itself (lives on the VPS) and `edgectl` (tenant-side tool, untouched)
- Docker daemon socket exposure — we only shell out to the `docker` CLI
- User CRUD — users are OS accounts

## Further Notes

- **Runs as root on a VPS**: the blast radius of this app is "everything on the box". Keep both processes bound to localhost behind a TLS reverse proxy, give `ADMIN_PASSWORD` **and `AGENT_TOKEN`** real entropy, and treat the VPS-side provisioning script as the single extension point — never grow command-execution surface in the panel itself.
- **On the VPS, exactly three things need hand-editing**: the two `.env` files (`server/.env` and `agent/.env`, sharing one `AGENT_TOKEN`) and the provisioning script itself.
- `data/` is runtime state → gitignore it.
- Future: if the JSON store or shelling out to `docker ps` starts hurting, that's the signal for SQLite / dockerode — not before.
