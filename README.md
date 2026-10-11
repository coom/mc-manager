#### DISCLAIMER:
![AI Assisted](https://img.shields.io/badge/AI%20Assisted-Project-00ADD8?style=for-the-badge&logo=dependabot&logoColor=white)

# MC Manager

**English** · [Français](README.fr.md)

Web interface to monitor and manage a Minecraft Java server running in Docker with [`itzg/minecraft-server`](https://github.com/itzg/docker-minecraft-server), with backups handled by [`itzg/mc-backup`](https://github.com/itzg/docker-mc-backup) (tar method). Start, stop and restart the server, follow the logs live, send RCON commands, watch players and server health, and list, download, delete or trigger backups. Multi-user with roles (`admin` / `viewer`), MFA, audit log. The UI is available in **English and French**.

## Features (lot 1)

- Multi-account authentication: first-admin setup wizard, login, TOTP MFA with recovery codes, trusted devices, password policy, user management
- Server control: live state (`unavailable`, `stopped`, `starting`, `ready`, `unhealthy`, `stopping`), uptime, start / stop / restart
- Console: live container logs (pause, text and level filters) and RCON commands with history and Tab completion (vanilla commands, online players, items, blocks, entities, effects, enchantments; `node packages/frontend/scripts/gen-mc-registry.mjs <version>` regenerates the identifier list for another Minecraft version)
- Dashboard: online players, attendance chart (24 h / 7 d / 30 d), CPU, RAM, MSPT / TPS, world size, free disk space
- Backups: list, download, delete, manual trigger with live output, **restore** (safety backup, server stop, replacement of the archive's data, restart, live progress). A download asks the backend for a single-use link valid for 60 seconds (`POST /api/backups/:name/link`, admin, audited) that the browser then follows, so the archive streams straight to disk
- Audit log of every admin action (RCON commands, backups, server control, users)
- Players: online and known players, player pages with vanilla statistics (play time, deaths, kills, distance...), kick / ban / IP ban / op / deop actions, whitelist, operators and bans managed from the interface
- Connection journal (admin): Minecraft connections with IP, country and duration, refused connections, successful or failed logins to MC Manager; configurable retention (90 days by default)
- Configuration: `server.properties` editor (form for the common keys and raw file); keys enforced by the itzg container variables are shown locked; restart offered after saving
- Mods: Modrinth mods of a modded server (Fabric, Quilt, Forge, NeoForge) or plugins (Paper and derivatives) listed, enabled, disabled, added or removed from the interface, plus jars dropped by hand; restart offered when the list differs from what the server loaded (see [Mods](#mods))
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
| `MC_DATA_DIR` | `/mc/data` | Mount point of the Minecraft data (read-write) |
| `MC_BACKUPS_DIR` | `/mc/backups` | Mount point of the backups |
| `MC_RCON_HOST` | `MC_CONTAINER` | RCON host |
| `MC_RCON_PORT` | `25575` | RCON port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path. Only matters when running the backend outside Docker (`pnpm dev`): in the container the socket is always bind-mounted at `/var/run/docker.sock` and compose does not forward this variable |
| `MC_DATA_VOLUME` / `MC_BACKUPS_VOLUME` | required (compose) | Names of the Docker volumes of the Minecraft stack |
| `MC_NETWORK` | `mc-network` | Docker network shared with Minecraft |
| `DOCKER_GID` | `999` | Group id of the Docker socket on the host |

The RCON password is **never** configured here: the backend reads it from `server.properties` on the mounted data volume.

### Volumes and network

`docker-compose.yml` declares `mc-data` and `mc-backups` as **external** volumes whose real names come from `MC_DATA_VOLUME` and `MC_BACKUPS_VOLUME`; they must already exist (the reference stack creates them with these exact names). The Minecraft data is mounted read-write on `/mc/data` (needed by restore and the `server.properties` editor), the backups read-write on `/mc/backups`. If your data lives in a bind-mounted directory instead of a named volume, replace the `mc-data:/mc/data` and `mc-backups:/mc/backups` entries by your host paths (and remove the two top-level volume declarations). The backend joins the external network `MC_NETWORK` to reach RCON.

### Volume ownership

The backend runs as the `node` user (UID 1000). It must be able to delete archives in `mc-backups`, and to write in the data volume (`/data` of the Minecraft container) for restore and the `server.properties` editor. `itzg/mc-backup` runs as root by default, which leaves a root-owned directory and archives that the backend cannot delete (EACCES). The reference stack therefore runs `mc-backup` with `user: "1000:1000"`; do the same in your own stack. To fix an existing root-owned volume: `docker run --rm -v mc-backups:/b alpine chown -R 1000:1000 /b` (or `chown -R 1000:1000` on the host path). Do the same for the data directory if the backend cannot write there: `chown -R 1000:1000 <data dir>`, contents included. Write failures are reported explicitly in the interface (`EACCES`, `EROFS`, `ENOSPC`).

### Upgrading from lot 2a

Three host-side changes are needed:

- Remove `:ro` from the `/mc/data` mount in `docker-compose.yml`. The repository file is already updated, but if you adapted it to host paths you must do it by hand.
- Make sure the data directory and its contents are owned by UID 1000: `chown -R 1000:1000 <data dir>`.
- Decide on `OVERRIDE_SERVER_PROPERTIES` in the Minecraft stack (see "Server configuration").

### Docker socket warning

The backend mounts `/var/run/docker.sock`. **Access to the Docker socket is equivalent to root access on the host.** Anyone who compromises the backend can take over the machine. Only expose MC Manager behind its authentication, preferably behind a reverse proxy with HTTPS, use strong secrets and enable MFA for admin accounts. Do not publish port 3000 to the open internet without these protections. Since lot 2b the backend also writes into the server data (restore, `server.properties`), which makes authentication and MFA for admin accounts all the more important.

## Restore

An admin restores a backup from the Backups page. The operation runs in six steps, with live progress:

1. check: the archive is validated entry by entry before anything is written;
2. safety: a new backup is taken first, so that the current state can be recovered;
3. stop: the server is stopped (the operation waits until it is actually stopped);
4. replace: the data to be replaced is removed;
5. extract: the archive is extracted into the data directory;
6. start: the server is started again.

Only gzip archives (`.tgz`, `.tar.gz`) are accepted. The top-level entries of the archive (world folders, `plugins`, files) replace their counterparts in the data directory, EXCEPT the paths matching the `mc-backup` exclusions, which are never in the archives and are therefore kept: by default `*.jar`, `cache`, `logs` and `*.tmp` (so plugin and mod jars stay in place); if the `mc-backup` container sets `EXCLUDES`, that list is used instead (an empty `EXCLUDES=` means no exclusion). Everything the archive does not contain at the top level is kept.

Before anything is written, the backend checks that it can write into the data directory and that the volume has at least as much free space as the uncompressed archive (refusal with an explicit message otherwise). The archive is opened once at the check step, so the pruning that `mc-backup` performs after the safety backup cannot remove it mid-restore.

If the server is already stopped, no safety backup can be taken: an explicit confirmation ("no safety backup") is required. If the operation fails before anything was removed (safety backup, stop, preflight), it is reported as `aborted:`, the data is untouched and the server is started again if it had been stopped and "start afterwards" was checked. If it fails part way (`partial restore:`), the interface reports the name of the safety backup so that you can restore it.

**Interrupted restores.** While data is being replaced, the backend keeps a marker file `.mc-manager-restore.json` in the data directory (archive name, safety backup, start time, step); it is removed as soon as the extraction succeeds. If the backend stops or crashes in between, the marker remains: at the next start the backend logs an error and the Backups page shows a persistent warning with the archive and the safety backup. The data may be half restored: restore the safety backup ("Restore this one"), or, once you have handled it by hand, click "Dismiss" (admin, audited) to remove the marker. Only one operation at a time touches the data (manual backup, restore, `server.properties` edit): another request receives a 409.

## Server configuration

The Configuration page edits `server.properties`, either through a form of the common keys or as the raw file. Saving is atomic and the interface then offers to restart the server.

- Keys governed by an environment variable of the itzg container are shown locked and cannot be changed here: the container rewrites them at each start. Setting `OVERRIDE_SERVER_PROPERTIES=false` in the Minecraft stack makes the file authoritative instead, which frees these keys. The form shows a hint explaining this whenever a locked key is present.
- The RCON keys (`enable-rcon`, `rcon.port`, `rcon.password`) are always locked and the RCON password is never shown.
- Changes only take effect after a restart.

## World

The World page (admin only) adjusts the running world through RCON, without a restart: time of day and weather (with "freeze" switches backed by `doDaylightCycle` / `doWeatherCycle`), tick rate, freeze and sprint (`/tick`, Minecraft 1.20.3+), difficulty, default game mode and a curated list of game rules.

- Every action is a single validated command, audited as `world.*` before it is sent. Nothing is written to `/data` by MC Manager: the server persists these values in the world itself.
- Difficulty and default game mode are also written to `server.properties` by the server. If `DIFFICULTY` or `MODE` is set in the container environment, the itzg image resets them at the next start; the page says so.
- Game rules use the registry IDs introduced in Minecraft 1.21.11 (`keep_inventory`, `advance_time`, ...). On an older server the page detects it and falls back to the former camelCase names.
- The weather has no read command in vanilla, so no current state is shown for it.

## Mods

The Mods page lists the mods (or plugins) of a modded server and lets an admin enable, disable, add or remove them. Nothing is loaded at runtime: every change applies at the next restart, and the page says so.

- **Modrinth mods** are the entries of `MODRINTH_PROJECTS`. MC Manager owns a listing file in the data volume, `/data/mc-manager/modrinth-projects.txt`, in the native itzg format (one entry per line, `#` comments). Point the variable to it in the Minecraft stack:

  ```yaml
  environment:
    TYPE: FABRIC
    MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"
  ```

  If the variable still holds an inline list, the page offers to import it once. Disabling a mod comments its line; the image removes its jar at the next start and downloads it again when re-enabled. Adding a mod takes a Modrinth slug (optionally `slug:version`, a `fabric:`/`paper:`/`datapack:` prefix or a trailing `?` for optional), verified against the Modrinth API before it is written.
- **Manual jars** dropped by hand in `mods/` (or `plugins/`) that the image does not manage are toggled by renaming them to `.jar.disabled`.
- **Catalogue**: the search box of the Modrinth card queries Modrinth through the backend (filtered on the server loader and, when known, the running Minecraft version) and adds a result with one click; typing a slug and pressing Enter still works. The "Browse catalogue" button opens the full catalogue without typing anything: sorted by popularity, novelty, recent updates or followers, filtered by category (optimization, utility, world generation, ...), 20 by 20, with an optional name filter; adding from there keeps the window open.
- **Upload**: drop a `.jar` on the Manual jars card. The backend streams it to a temporary file, checks that it is a valid archive carrying the descriptor of the server loader (`fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`, `plugin.yml`, `paper-plugin.yml`), reads its id, name and version, refuses duplicates (same file name unless you choose to replace, same mod id in another file, or a file managed by Modrinth) and moves it into the folder. Limit: 100 MB (nginx and backend). Manual jars can be deleted from the page; Modrinth-managed ones cannot.
- Supported server types: `FABRIC`, `QUILT`, `FORGE`, `NEOFORGE` (folder `mods/`) and `PAPER`, `SPIGOT`, `BUKKIT`, `PURPUR`, `FOLIA` (folder `plugins/`). On a vanilla server the page is read-only.
- All writes are admin-only, audited, and serialized with backups, restores and `server.properties` edits.

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

The dashboard, the Players page and the player sheets show player avatars loaded from the third-party service [mc-heads.net](https://mc-heads.net): the browser of every user sends the names of the online players to that service. The interface fonts (Outfit, JetBrains Mono) are also loaded from Google Fonts (`fonts.googleapis.com`), which exposes the visitor IP address to Google.

The Mods page is the only other source of external calls: when an admin adds a mod, and once per unknown entry of the listing file, the backend queries `api.modrinth.com` to verify the project and cache its title and icon; the browser then loads mod icons from `cdn.modrinth.com`. The catalogue search is also relayed by the backend: only the search text, the server loader and the Minecraft version are sent to `api.modrinth.com`. Nothing else is sent to Modrinth.

IP geolocation uses the `geoip-lite` database embedded in the image (the one shipped with geoip-lite 2.0.2, with no automatic update): no external call, country only. IP addresses are visible to admins only, and the journal is purged according to the configured retention.

## Roadmap

Lots 2a (players, journals), 2b (restore, `server.properties` editor) and 3 (mods) are delivered.

Out of scope: editing the backup schedule, editing the container environment, managing several servers.

## License

MIT
