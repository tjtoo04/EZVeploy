# Product

<!-- impeccable:product-schema 1 -->

## Platform

web — self-hosted admin dashboard, accessed over the LAN/internet through a TLS reverse proxy.

## Stack

User decision (explicit): Node.js Fastify 5 as **two processes** — an **agent** that runs as root on the VPS and owns every OS-touching capability (passwd, per-user docker sockets, the provisioning script), and an **API gateway** that serves the UI and delegates to the agent over localhost — plus Vue 3 UI with PrimeVue 4 components. Same-origin in production (gateway serves the built UI). No CORS dependency. No docker/compose anywhere; both processes run bare on the box. Provisioning script lives on the VPS, invoked by path from the agent's env (`PROVISION_SCRIPT`).

## Users

Primary user: a solo admin (this project's owner) who runs a multi-tenant VPS as root and manages Docker deployments for tenants. No other authenticated roles — single-admin panel.

## Product Purpose

Give the admin a web panel to (1) see all running Docker containers, grouped by the tenant user who owns them, (2) observe any single container (logs + resource snapshot), and (3) add/read domains mapped to tenant users, without SSHing in for any of it. Success = the admin can answer "what is tenant X running, is it healthy, and what domains point at them" from the browser.

## Positioning

The same box an admin already trusts — root access to the VPS — becomes the panel's data source. User-per-daemon rootless Docker (per the edgectl tenant guide) makes container ownership structural: no agent on tenant machines, no polling a central Docker API, just the admin panel reading every user's unix socket directly.

## Operating Context

- VPS root user; Node >= 22. Each tenant runs **rootless Docker** (one per-user daemon at `/run/user/<uid>/docker.sock`), plus `edgectl`-managed per-tenant edge nginx (see `~/Downloads/EDGECTL.md` on the dev machine).
- Domains map at the front proxy: a VPS-side provisioning script turns `<domain>` into a mapping to `<user>`'s fixed edge port range.
- The admin edits exactly three things on the VPS by hand: `server/.env` (admin creds, agent URL + shared token), `agent/.env` (script path, shared token, blocklist), and the provisioning script itself. Everything else goes through the panel.
- Dev happens on the admin's local machine; the repo is a monorepo (`agent/` + `server/` + `ui/`).

## Capabilities and Constraints

- Read `/etc/passwd` for the single source of truth of tenant users (`uid >= 1000`, `/home/` homes, blocklist via `USER_BLOCKLIST`). This one list feeds the dropdown and container grouping.
- Enumerate per-user daemons; group containers by owner. `daemon: up|down` per user. Root's own daemon included as the admin group.
- Per-container observability: log tail (default 200 / max 2000 lines), live SSE log follow with reconnect, resource snapshot (`docker stats`). Scoped `:user/:name` (names are not unique across daemons).
- Add domain: validate (strict domain regex, allowlist user), dedupe (stored + in-flight), execute provisioning script via argv array only, ~60s timeout, capture output. Persist successes to JSON atomically.
- Basic auth (env creds, constant-time compare) on every gateway route. Gateway → agent is a shared Bearer token (`AGENT_TOKEN`); the agent binds `127.0.0.1:3901` and is reachable from nowhere else. No shell-string interpolation anywhere; feature-flagged `DOCKER_BIN`/`PASSWD_FILE`/`PROVISION_SCRIPT` on the agent for tests.
- Explicitly undecided: whether the containers page also surfaces each tenant's edge port (a candidate column; user said "can be added anytime").
- Out of scope (confirmed): container start/stop/restart/exec, metrics history/graphing, multi-container log aggregation, user CRUD, RBAC, TLS termination in this repo.

## Brand Commitments

None provided. Product name used in-repo: EZVeploy. No voice, logo, or palette constraints supplied; the visual world is open (delegated to the build).

## Evidence on Hand

- `SPEC.md` (this repo) — full spec, user stories, API contract.
- `~/Downloads/EDGECTL.md` — the tenant rootless-Docker/edge-nginx guide the panel's data model follows.
- No real tenant data, screenshots, or VPS exports in this repo; UI demonstration data will be synthetic and labeled as such.

## Product Principles

1. Read-only where possible: containers and logs are observed, never mutated through the panel.
2. One source of truth per concern: OS accounts for users, per-user daemons for containers, JSON registry for domains, the VPS script for domain provisioning.
3. Root blast radius is the client's own; keep the command surface minimal, validated, and argv-scoped (never shell-interpolated). The agent is the only process with OS access — the gateway cannot reach the box.
4. The panel stays dumb about provisioning mechanics; the script remains the single extension point the user edits on the box.

## Accessibility & Inclusion

No product-specific requirement established beyond baseline web accessibility (keyboard-operable forms, contrast, focus states, semantic markup).
