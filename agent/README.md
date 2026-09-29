# EZVeploy agent

The **VPS agent**: the only process that touches the operating system. It runs
as root on the VPS, owns `/etc/passwd` reads, the per-user rootless docker
daemon sockets, container logs/stats/stream, and the provisioning script. The
API server (`server/`) is a pure HTTP gateway and never runs OS commands — it
talks to this agent over `http://127.0.0.1:3901` with a Bearer token.

Full deployment instructions (env files, systemd units, dev recipe) live in
the [root README](../README.md).

## Routes

Every route requires `Authorization: Bearer <AGENT_TOKEN>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{ ok, mode }` — mode is `fixture` or `live` |
| GET | `/users` | passwd-filtered tenant list + root |
| GET | `/containers` | per-daemon `docker ps` listing `{ containers, daemons }` |
| GET | `/containers/:user/:name/logs?lines=N` | log tail (raw text) |
| GET | `/containers/:user/:name/stats` | `docker stats` snapshot |
| GET | `/containers/:user/:name/logs/stream` | SSE live follow |
| POST | `/provision` | run the provisioning script; body `{ domain, user }` → `{ code, output, timedOut }` |

## Run

```bash
cd agent
cp .env.example .env     # set AGENT_TOKEN (and PROVISION_SCRIPT on the box)
npm install
npm start                # node --env-file-if-exists=.env src/index.js
```

## Tests

```bash
npm test                 # fixtures simulate docker daemons + the provision script
```