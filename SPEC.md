# Spec: VPS Admin Dashboard (EZVeploy)

## Problem Statement

The user runs a multi-tenant VPS as root, hosting other people's Docker containers and mapping domains to server users. There is currently no UI for this — every operation requires SSHing in, remembering which user owns which container, and hand-editing configs or running scripts manually.

## Solution

A small self-hosted admin dashboard on the VPS with three pages:

1. **Containers** — a live list of running Docker containers, grouped by the server user that owns them (each tenant runs **rootless Docker**, so the grouping is structural: every container lives in exactly one user's daemon). Each row links to that container's observability page.
2. **Observability** — a per-container page showing live logs and a resource snapshot.
3. **Add Domain** — a form (domain + owning-user dropdown) that runs the provisioning script on the server.

Backend is a Node.js/Fastify server (runs as root, executes OS commands). Frontend is Vue 3 + PrimeVue.

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

**Layout** — monorepo with two processes, one port in prod:

- `server/` — Fastify 5 API. In production it serves the built Vue app statically (single port). In dev, Vite proxies `/api` → Fastify (same-origin, so **no CORS dependency at all**).
- `ui/` — Vue 3 + Vue Router + PrimeVue 4.
- The provisioning script is **NOT in this repo** — it lives on the VPS. The server invokes whatever `PROVISION_SCRIPT` points at (see below).

**Users (single source of truth: system accounts)** — `lib/users.js` reads `/etc/passwd` (no dependency; root read is trivial), filters to `uid >= 1000` with a home under `/home/`, excludes an env configurable blocklist (`USER_BLOCKLIST`). Sorted list. This one list feeds both the container grouping and the domain dropdown, so dropdown entries always match real server users. No user CRUD — users are OS accounts.

**Provisioning script** — lives on the VPS; configured via the `PROVISION_SCRIPT` env var (absolute path). It is the admin-side step of the edgectl flow (`40-proxy.sh` in the guide): adding a domain maps `<domain> → <user>`'s edge port at the front proxy. The script is responsible for looking up the user's fixed edge port range; the panel stays dumb. Contract: `<script> <domain> <user>`, `set -euo pipefail`, exit code 0 = success, stdout = human-readable summary. The panel never embeds or ships any script logic — it only ever invokes `${PROVISION_SCRIPT} <domain> <user>` via an argv array, capturing stdout+stderr, with a ~60s timeout (child killed on expiry). **Where to edit on the VPS: the `.env` file next to the server** (only the script path and admin credentials should ever need hand-editing there).

**Containers** — tenants run **rootless Docker**, one per-user daemon, per the edgectl guide on the VPS. The panel enumerates system users (same `/etc/passwd` source as the dropdown), and for each user whose daemon socket exists runs `docker --host unix:///run/user/<uid>/docker.sock ps --format "{{json .}}"` (running containers only, NDJSON). Ownership is structural: containers returned from user X's daemon belong to X. Doing this as root is fine — root can connect to any user's unix socket, no `sudo -u` needed. A user with no socket (daemon never started / linger disabled) yields a per-user `"daemon down"` state instead of failing the whole list; root's own daemon is included as an "admin" group. Container names are **not globally unique** across daemons (two tenants can both have `web`), so every container reference carries its user.

Raw CLI over `dockerode`: we're already root, already shelling for the script, and `docker ps --format` JSON is parseable — zero new dependencies.

**Observability** — every command is scoped to the owning user's daemon (`docker --host unix:///run/user/<uid>/docker.sock …`), so routes take `:user/:name`:

- `GET /api/containers/:user/:name/logs?lines=N` → `docker logs --tail N` (caps: default 200, max 2000), raw text.
- `GET /api/containers/:user/:name/logs/stream` → SSE live-follow: spawns `docker logs -f --tail N --since=` per client against that daemon, pipes lines as `data:` events, kills the child on client disconnect (Fastify `onSend`/response close). `-n` reconnect policy: client catches the close and reconnects after 1s.
- `GET /api/containers/:user/:name/stats` → `docker stats --no-stream --format json` snapshot (CPU%, MEM usage/limit). Single snapshot per request — no metrics history.
- Both `:user` (validated against the passwd allowlist) and `:name` (Docker's `[a-zA-Z0-9][a-zA-Z0-9_.-]*` shape) are validated; the command result distinguishes "container not found" (exit 1) from other failures.

**Domain store** — `lib/domains.js` persists to a JSON file (`data/domains.json`, path via `DATA_DIR` env), written atomically (tmp file + rename). Single admin panel, low write volume — a full DB is unrequested weight. Records: `{ id, domain, user, createdAt, lastResult }`. Only successful provisions are persisted; the list doubles as the dedupe source. Upgrade to SQLite if it ever outgrows this.

**Add-domain flow**:

1. Normalize (trim, lowercase, strip scheme/trailing dot if pasted) and validate against strict regex (letters/digits/hyphens/dots/wildcard `*.` prefix only, no `..`, max 253 chars). Invalid → `422`.
2. User must be in the current system-users list (allowlist) → else `422`.
3. Already in the store → `409`; already in the in-flight set → `409`.
4. Execute `bash ${PROVISION_SCRIPT} <domain> <user>` — **argv array, no shell string interpolation, ever**. Exit 0 → `201` with trimmed stdout; non-zero → `500` with stderr. Timeout ~60s (kill the child).

**Security (non-negotiable, this runs as root)**:

- Basic auth on all routes: `ADMIN_USER`/`ADMIN_PASSWORD` env, constant-time compare, custom hook — no auth dependency needed.
- Bind to `127.0.0.1` by default (env overridable); TLS/reverse-proxy is the user's job (noted, not built).
- All user input validated at the API boundary (422) and re-checked in the service layer; commands run via argv arrays only. The passwd allowlist is an explicit anti-injection device: no username string ever reaches a shell. Container names in observability routes are validated against the same `[a-zA-Z0-9][a-zA-Z0-9_.-]*` shape Docker itself accepts (no slashes/spaces).

**API contract**:

- `GET /api/users` → `[ { name, uid, home } ]`
- `GET /api/containers` → `[ { id, name, image, status, ports, user } ]` + per-user daemon state `[ { name, daemon: "up" | "down" } ]` (grouped client-side)
- `GET /api/containers/:user/:name/logs?lines=N` → `200` text | `404` unknown container/daemon
- `GET /api/containers/:user/:name/logs/stream` → SSE `text/event-stream`
- `GET /api/containers/:user/:name/stats` → `200` JSON | `404` unknown container/daemon
- `POST /api/domains` `{ domain, user }` → `201 { id, domain, user, createdAt, lastResult }` | `409` dup | `422` invalid | `500` script failure `{ error, output }`
- `GET /api/domains` → `[ { id, domain, user, createdAt, lastResult } ]`

**Frontend** — PrimeVue: `TabMenu` (Containers / Add Domain) + router route `/containers/:user/:name` for observability. Containers page: `DataTable` with `rowGroupMode="subheader"` grouping by owner, `Tag` for status, row click → `/containers/:user/:name`. Observability page: `Tag`-style stat cards (CPU%, MEM), monospace log viewport with auto-scroll + freeze toggle, follow button (switches to the SSE stream). Add Domain page: `Dropdown` + `InputText` + `Button`, spinner-on-button while provisioning, `Toast` for results, separate `DataTable` of provisioned domains. Validation rules mirrored client-side with server messages shown via `InlineMessage`.

**Config env** — `HOST`, `PORT`, `ADMIN_USER`, `ADMIN_PASSWORD`, `DATA_DIR`, `PROVISION_SCRIPT`, `USER_BLOCKLIST`.

## Testing Decisions

- **A good test asserts HTTP behavior and the argv contract, not script internals.**
- **Seam 1 — HTTP:** Fastify's built-in `app.inject()` (no sockets). Covers auth `401`s, validation `422`s, dedupe `409`s, `404` unknown container, and the `201`/`500` paths.
- **Seam 2 — OS commands:** all external command execution goes through one thin `lib/exec.js` wrapper, and the `DOCKER_BIN` env var lets tests point "docker" at a fixture script (`test/fixtures/docker`). The fixture keys its output off the `--host` argument, so per-user daemon behavior (container lists, "not found", `docker logs`/`docker stats`) is simulated per socket path. `PROVISION_SCRIPT` likewise points at a fixture script (`test/fixtures/provision-domain.sh`) that echoes its args and exits per mode. This covers the real runner + correct argv (`--host` + command) passing — the security-relevant behavior — without touching docker, the network, or the real script. The SSE stream endpoint is tested by reading the fixture's emitted lines from `app.inject()`'s response body.
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

- **Runs as root on a VPS**: the blast radius of this app is "everything on the box". Keep it bound to localhost behind a TLS reverse proxy, give `ADMIN_PASSWORD` real entropy, and treat the VPS-side provisioning script as the single extension point — never grow command-execution surface in the panel itself.
- **On the VPS, only two things need hand-editing**: the `.env` file next to the server (script path + admin creds) and the provisioning script itself.
- `data/` is runtime state → gitignore it.
- Future: if the JSON store or shelling out to `docker ps` starts hurting, that's the signal for SQLite / dockerode — not before.
