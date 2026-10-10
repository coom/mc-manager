#### DISCLAIMER:
![AI Assisted](https://img.shields.io/badge/AI%20Assisted-Project-00ADD8?style=for-the-badge&logo=dependabot&logoColor=white)

# MC Manager

**English** · [Français](README.fr.md)

Web interface to monitor and manage a Minecraft Java server running in Docker with [`itzg/minecraft-server`](https://github.com/itzg/docker-minecraft-server), with backups handled by [`itzg/mc-backup`](https://github.com/itzg/docker-mc-backup) (tar method). Start, stop and restart the server, follow the logs live, send RCON commands, watch players and server health, and list, download, delete or trigger backups. Multi-user with roles (`admin` / `viewer`), MFA, audit log. The UI is available in **English and French**.

## Features (lot 1)

- Multi-account authentication: first-admin setup wizard, login, TOTP MFA with recovery codes, trusted devices, password policy, user management
- Server control: live state (`unavailable`, `stopped`, `starting`, `ready`, `unhealthy`, `stopping`), uptime, start / stop / restart
- Console: live container logs (pause, text and level filters) and RCON commands with history
- Dashboard: online players, attendance chart (24 h / 7 d / 30 d), CPU, RAM, MSPT / TPS, world size, free disk space
- Backups: list, download, delete, manual trigger with live output. A download asks the backend for a single-use link valid for 60 seconds (`POST /api/backups/:name/link`, admin, audited) that the browser then follows, so the archive streams straight to disk
- Audit log of every admin action (RCON commands, backups, server control, users)
- Players: online and known players, player pages with vanilla statistics (play time, deaths, kills, distance...), kick / ban / IP ban / op / deop actions, whitelist, operators and bans managed from the interface
- Connection journal (admin): Minecraft connections with IP, country and duration, refused connections, successful or failed logins to MC Manager; configurable retention (90 days by default)
- Dark and light themes, English and French

## Screenshots

_Coming soon._

## Requirements

- A Docker host (Linux recommended) with Docker Compose v2
- A Minecraft container based on `itzg/minecraft-server` with RCON enabled, version 1.20.3 or later for `tick query` (MSPT; below that MSPT is simply absent; on Paper `tps` is used as well)
- An `itzg/mc-backup` container with `BACKUP_METHOD: tar`
- MC Manager runs on the **same Docker host** as the Minecraft server and shares its Docker network

A complete reference stack is provided in [`docker-compose.example.yml`](docker-compose.example.yml).

> Status: the deployment files were validated by parsing only (`docker compose config`). A full end-to-end run on a real Docker host is still pending.

## Deployment

1. (Optional) Start the reference Minecraft stack, or use your own:

   ```bash
   docker compose -f docker-compose.example.yml up -d
   ```

   Change the two `change-me` RCON passwords first. The stack creates the volumes `mc-data` and `mc-backups` and the network `mc-network`.

2. Configure MC Manager:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   - `JWT_SECRET` and `ENCRYPTION_KEY`: required, 32 characters minimum and **different** from each other (`openssl rand -hex 32` twice).
   - `FRONTEND_URL`: the exact origin your browser uses (CORS), for example `http://localhost:3000` or `https://mc.example.com`. The `.env.example` default (`http://localhost:5173`) is for local development only.
   - `MC_DATA_VOLUME`, `MC_BACKUPS_VOLUME`, `MC_NETWORK`: names of the existing volumes and network of your Minecraft stack.
   - `DOCKER_GID`: group id of the Docker socket on the host, `stat -c %g /var/run/docker.sock` (the container runs as the unprivileged `node` user and gets this group through `group_add`).

3. Build and start:

   ```bash
   docker compose up -d --build
   ```

4. Open `http://localhost:3000` (or `FRONTEND_PORT`) and create the first admin account.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | required | Signs sessions, 32+ characters |
| `ENCRYPTION_KEY` | required | Encrypts stored secrets (TOTP), 32+ characters, different from `JWT_SECRET` |
| `DATABASE_URL` | set by compose | SQLite file, persisted in the `backend-data` volume |
| `FRONTEND_URL` | `http://localhost:3000` in compose | Allowed CORS origin |
| `FRONTEND_PORT` | `3000` | Published port of the web interface |
| `MC_CONTAINER` | `mc` | Name of the Minecraft container |
| `MC_BACKUP_CONTAINER` | `mc-backup` | Name of the mc-backup container |
| `MC_DATA_DIR` | `/mc/data` | Mount point of the Minecraft data (read-only) |
| `MC_BACKUPS_DIR` | `/mc/backups` | Mount point of the backups |
| `MC_RCON_HOST` | `MC_CONTAINER` | RCON host |
| `MC_RCON_PORT` | `25575` | RCON port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path. Only matters when running the backend outside Docker (`pnpm dev`): in the container the socket is always bind-mounted at `/var/run/docker.sock` and compose does not forward this variable |
| `MC_DATA_VOLUME` / `MC_BACKUPS_VOLUME` | required (compose) | Names of the Docker volumes of the Minecraft stack |
| `MC_NETWORK` | `mc-network` | Docker network shared with Minecraft |
| `DOCKER_GID` | `999` | Group id of the Docker socket on the host |

The RCON password is **never** configured here: the backend reads it from `server.properties` on the mounted data volume.

### Volumes and network

`docker-compose.yml` declares `mc-data` and `mc-backups` as **external** volumes whose real names come from `MC_DATA_VOLUME` and `MC_BACKUPS_VOLUME`; they must already exist (the reference stack creates them with these exact names). The Minecraft data is mounted read-only on `/mc/data`, the backups read-write on `/mc/backups`. If your data lives in a bind-mounted directory instead of a named volume, replace the `mc-data:/mc/data:ro` and `mc-backups:/mc/backups` entries by your host paths (and remove the two top-level volume declarations). The backend joins the external network `MC_NETWORK` to reach RCON.

### Volume ownership

The backend runs as the `node` user (UID 1000) and must be able to delete archives in `mc-backups`. `itzg/mc-backup` runs as root by default, which leaves a root-owned directory and archives that the backend cannot delete (EACCES). The reference stack therefore runs `mc-backup` with `user: "1000:1000"`; do the same in your own stack. To fix an existing root-owned volume: `docker run --rm -v mc-backups:/b alpine chown -R 1000:1000 /b` (or `chown -R 1000:1000` on the host path).

### Docker socket warning

The backend mounts `/var/run/docker.sock`. **Access to the Docker socket is equivalent to root access on the host.** Anyone who compromises the backend can take over the machine. Only expose MC Manager behind its authentication, preferably behind a reverse proxy with HTTPS, use strong secrets and enable MFA for admin accounts. Do not publish port 3000 to the open internet without these protections.

## Roles

| Role | Rights |
|---|---|
| `viewer` | Read-only: dashboard, console logs (no command field), backup list, audit log, players, player pages without IP, whitelist, ops and bans (read-only) |
| `admin` | Everything: start / stop / restart, RCON commands, manual backup, backup download and deletion, user management, player actions, whitelist, connection journal |

Every admin action is written to the audit log.

## Development

Requirements: Node.js 20+ (22 in CI and Docker), pnpm 9.

```bash
pnpm install
cp .env.example .env                  # set JWT_SECRET and ENCRYPTION_KEY
pnpm db:generate                      # generates the Prisma client (git-ignored), required before typecheck/build
pnpm --filter @mc/common run build    # backend and frontend import @mc/common from its dist/
pnpm dev                              # backend :3001 + frontend :5173 (Vite proxies /api and /ws)

pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Tests never need Docker or an RCON server (fakes are injected). When developing without a Minecraft container, the server state is `unavailable`.

i18n: write a fragment in `packages/frontend/scripts/i18n-fragments/*.json`, then merge it into both locales with `node packages/frontend/scripts/merge-i18n.mjs` (fails if the keys diverge from `en.json`).

## Privacy

The dashboard shows player avatars loaded from the third-party service [mc-heads.net](https://mc-heads.net): the browser of every user sends the names of the online players to that service. The interface fonts (Outfit, JetBrains Mono) are also loaded from Google Fonts (`fonts.googleapis.com`), which exposes the visitor IP address to Google. There is no other external call.

IP geolocation uses the `geoip-lite` database embedded in the image: no external call, country only. IP addresses are visible to admins only, and the journal is purged according to the configured retention.

## Roadmap

Lot 2a (players, journals) is delivered.

### Lot 2b

- Backup restoration
- `server.properties` editor

Out of scope: editing the backup schedule, editing the container environment, managing several servers.

## License

MIT
