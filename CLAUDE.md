# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

MC Manager : interface web de suivi et de gestion d'un serveur Minecraft Java sous Docker (`itzg/minecraft-server`, sauvegardes par `itzg/mc-backup` en méthode tar). Stack et module d'authentification repris de `ts6-manager`. Monorepo pnpm à trois packages :

| Package | Rôle |
|---------|------|
| `packages/backend` (`@mc/backend`) | Express + Prisma/SQLite, dockerode, client RCON, collecteur de métriques, serveur WebSocket |
| `packages/frontend` (`@mc/frontend`) | SPA React 18 / Vite / Tailwind / shadcn, TanStack Query, zustand, i18next (fr, en) |
| `packages/common` (`@mc/common`) | Types et constantes partagés (messages WebSocket, DTO, rôles), pas de schémas zod |

La spec est dans `docs/superpowers/specs/2026-10-10-mc-manager-lot1-design.md`. Les lots 1, 2a et 2b sont implémentés.

## Commandes

Prérequis : Node 20+ (CI et Docker en 22), pnpm 9. Le backend refuse de démarrer sans `JWT_SECRET` et `ENCRYPTION_KEY` (32 caractères minimum, différents l'un de l'autre) ; copier `.env.example` en `.env` à la racine.

```bash
pnpm install
pnpm db:generate                          # OBLIGATOIRE avant typecheck/build : client Prisma généré dans packages/backend/generated/ (gitignoré)
pnpm --filter @mc/common run build        # backend et frontend importent @mc/common depuis son dist/

pnpm dev                                  # backend :3001 + frontend :5173 (Vite proxifie /api et /ws vers 3001)
pnpm dev:backend / pnpm dev:frontend

pnpm lint                                 # eslint flat config à la racine
pnpm typecheck                            # tsc --noEmit dans chaque package
pnpm test                                 # vitest (backend et frontend)
pnpm build

# Un seul fichier ou un seul test (backend)
pnpm --filter @mc/backend exec vitest run src/backups/backup-service.test.ts
pnpm --filter @mc/backend exec vitest run -t "nom du test"

# i18n : après avoir écrit un fragment dans packages/frontend/scripts/i18n-fragments/*.json
node packages/frontend/scripts/merge-i18n.mjs   # fusionne dans fr/en et échoue si les clés divergent de en.json

# Complétion de la console : régénère src/components/console/registry.json depuis minecraft-data (devDependency)
node packages/frontend/scripts/gen-mc-registry.mjs [version]   # sans argument : dernière version Java supportée
```

La CI (`.github/workflows/ci.yml`) enchaîne : `pnpm install --frozen-lockfile`, `pnpm audit --audit-level high` (deux avis GHSA sans correctif amont sont ignorés via `pnpm.auditConfig.ignoreGhsas` dans `package.json` : `deepmerge-ts` tiré par la CLI Prisma et `braces` tiré par Tailwind, outils de build uniquement ; retirer l’exclusion dès qu’Ne version corrigée existe), `db:generate`, build de common, lint, typecheck, test, build, puis build des deux Dockerfiles (`Dockerfile.backend`, `Dockerfile.frontend`). Reproduire cet ordre en local avant de pousser.

`geoip-lite` est épinglé en `2.0.2` (sans caret) : toutes les versions 2.x déclarent `engines.node >= 24` alors que CI et Docker tournent en Node 22 ; pnpm n'émet qu'un avertissement, et ts6-manager fait tourner cette même version en production sur `node:22-slim`. Ne pas élargir la plage sans passer la CI et l'image sur Node 24. `Dockerfile.backend` supprime les fichiers `geoip-city*.dat` de l'image finale pour que la bibliothèque se rabatte sur la base pays seule (la fonctionnalité est limitée au pays, et la base ville pèse ~110 Mo en mémoire).

Déploiement : `docker compose up -d --build` (WebApp seule, rejoint le réseau Docker du serveur Minecraft). `docker-compose.example.yml` est une stack Minecraft de référence qui crée les volumes `mc-data`, `mc-backups` et le réseau `mc-network`. Le déploiement n'a été validé que par `docker compose config`, pas encore par un test de bout en bout.

## Schéma et migrations Prisma

- `packages/backend/prisma/schema.prisma` est la **source de vérité**. `packages/backend/prisma/migrations/` est gitignoré : il n'y a pas d'historique de migrations dans le dépôt.
- En production, le conteneur exécute `prisma db push --skip-generate` au démarrage (CMD de `Dockerfile.backend`), puis `node dist/index.js`. Pas de `migrate deploy`. `prisma/seed.ts` est un no-op.
- Config CLI dans `packages/backend/prisma.config.ts`. En local : `pnpm db:push`.

## Architecture backend

Ordre de démarrage de `src/index.ts` (à respecter, les listeners doivent exister avant `docker.start()`) :

1. `config.ts` est validé à l'import (`process.exit(1)` si secrets manquants/courts) ; `ENCRYPTION_KEY` doit différer de `JWT_SECRET`.
2. Prisma, `createApp()`, serveur HTTP partagé avec le `WebSocketServer` (`/ws`).
3. `DockerService`, `app.locals.serverInfo`, listener `status` -> broadcast `server.status`.
4. `LogStreamer` + listener WebSocket `authenticated`.
5. `docker.start()`, puis `RconService` (mot de passe RCON lu dans `server.properties` du volume monté, jamais dans l'environnement), `logs.start()`.
6. `MetricsCollector`, `BackupService`, puis `server.listen`.

Les services sont exposés via `req.app.locals.{prisma, docker, rcon, logs, metrics, backups, wss}` (pas de conteneur d'injection).

- **États du serveur** : `unavailable` (socket ou conteneur introuvable), `stopped`, `starting`, `ready`, `unhealthy`, `stopping`. La santé vient du healthcheck `mc-health` de l'image itzg ; l'uptime vient de `State.StartedAt`. Le conteneur est résolu par nom à chaque usage (pas de cache d'identifiant).
- **`DockerLike` / `RconLike`** : interfaces derrière `DockerService` et `RconService`. `docker/fake-docker.ts` et les fakes RCON servent aux tests ; les implémentations réelles sont `realDocker` et `realRcon`. Aucun test ne touche Docker ni RCON.
- **RCON** : connexion persistante, ouverte en `ready` ou `unhealthy` (fermée en `stopping`, `stopped`, `unavailable`), backoff exponentiel 1 à 30 s, file séquentielle avec timeout 10 s. Indisponible : `POST /api/server/command` répond 503 et le collecteur saute les champs RCON.
- **WebSocket** : le handshake authentifie le JWT d'accès (fermeture 4401 sinon) puis émet l'événement `authenticated`. Le handler dans `index.ts` appelle `markAuthenticated(socket)` (sans cela `broadcast` ignore la socket), envoie `server.status` et `log.history`. Le protocole est serveur vers client uniquement ; les commandes passent par HTTP pour être auditées.
- **LogStreamer** : un seul abonnement, tampon circulaire de 500 lignes. `start()` ouvre le flux avec `tail = cap` (historique initial) ; ensuite chaque passage à `starting`/`ready` rouvre avec `tail = 0` pour ne pas rejouer les lignes déjà reçues. Les lignes sont parsées en `{ ts, level, thread, message }`, niveau `RAW` sinon.
- **MetricsCollector** : tick toutes les 15 s (état seul si non `ready`, sinon `list`, `tick query`, `tps`, CPU/RAM), taille du monde (`<level-name>`, `_nether`, `_the_end`, `level-name` relu dans `server.properties`) et disque toutes les 5 min, tâche horaire qui agrège `MetricSample` en `MetricHourly` puis purge les échantillons de plus de 48 h (lignes horaires gardées 400 jours). Chaque tick écrit en base et diffuse `metrics.tick`.
- **BackupService** : ne liste que les fichiers réguliers `*.tgz` et `*.tar.gz` de `MC_BACKUPS_DIR`. `runNow()` fait `docker exec <MC_BACKUP_CONTAINER> backup now`, diffuse `backup.progress` ligne par ligne puis `backup.done` ; un seul backup manuel à la fois (409 sinon).
- **Téléchargement de backup** : `POST /api/backups/:name/link` (admin, audité `backup.download`) émet un jeton aléatoire en mémoire (`DownloadTokenStore`, 60 s, usage unique) ; `GET /api/backups/download/:token` est public (monté avant `authMiddleware`, le navigateur le suit sans en-tête Bearer) et streame le fichier avec `res.sendFile`.
- **Audit** : toute action d'admin écrit une ligne `AuditLog` avant de répondre.
- **Joueurs (lot 2a)** : `players/player-journal.ts` ouvre et ferme des `PlayerSession` à partir des lignes du `LogStreamer` (`parse-player-line.ts`), réconciliées par le `list` du collecteur (`onPlayers`) avec une grâce de 30 s ; les lignes Docker sont horodatées (`timestamps: true`, préfixe retiré par `splitTimestamp`) pour ignorer l'historique rejoué au démarrage. `players/player-admin.ts` envoie kick/ban/op/whitelist par RCON et interprète les réponses (409 déjà fait, 404 inconnu, 502 réponse inattendue). `players/data-files.ts` lit `whitelist.json`, `ops.json`, `banned-*.json`, `usercache.json` et `<level-name>/stats/<uuid>.json` en lecture seule. Journal web : `auth/web-login-journal.ts`, appelé en fire-and-forget dans `auth.routes.ts`. Rétention : `AppSetting` `journal.retentionDays`, purge quotidienne depuis `index.ts`.
- **Restauration (lot 2b)** : `backups/restore-service.ts` enchaîne check → safety (`backups.runNow({ lockHeld: true })`) → stop (attente de `status === 'stopped'`, 90 s) → replace → extract (`backups/archive-filter.ts` : gzip seulement, entrées validées avant toute écriture) → start, en diffusant `restore.progress` / `restore.done`. `data/data-lock.ts` sérialise sauvegarde manuelle, restauration et `server.properties` (409 sinon).
  - Sémantique : chaque entrée de premier niveau de l'archive remplace son homologue SAUF les chemins qui correspondent aux exclusions de mc-backup (`removeExcept`, glob sur le nom de base : `*.jar`, `cache`, `logs`, `*.tmp` par défaut, ou `EXCLUDES` lu dans `Config.Env` du conteneur mc-backup via `docker.backupEnv()` ; `EXCLUDES=` vide = aucune exclusion). Ne jamais revenir à un `rm -rf` du premier niveau : mc-backup garde les dossiers `plugins/`, `mods/` sans leurs jars.
  - Le check ouvre l'archive une seule fois (`openArchive`, descripteur tenu jusqu'à la fin) : le prune de mc-backup après la sauvegarde de sécurité ne peut pas la supprimer sous nos pieds. Pré-vérifications avant le 202 : `W_OK` sur dataDir et les cibles (500 avec `chown`), `statfs` ≥ taille décompressée (507, ignoré si `statfs` échoue).
  - Échec avant la première suppression → `aborted: …` et relance du serveur si on l'avait arrêté et `startAfter` ; après → `partial restore: …`, pas de relance.
  - Marqueur `<dataDir>/.mc-manager-restore.json` (`archive`, `safetyBackup`, `startedAt`, `step`) écrit avant la première suppression, supprimé après une extraction réussie. `restore.start()` (dans `index.ts`, avant `server.listen`) le lit au démarrage : `RestoreStatus.interrupted`, avertissement persistant sur la page Sauvegardes, `DELETE /api/backups/restore/interrupted` (admin, audité) pour le retirer.
- **server.properties** : `server-properties/properties-service.ts` lit (mot de passe RCON masqué), fusionne (`updateServerProperties`) ou remplace (mode brut validé) et écrit de façon atomique ; les clés gouvernées par `Config.Env` du conteneur (`server-properties/itzg-env.ts`) et les clés RCON sont refusées en 409. Routes `GET/PUT /api/server/properties` (admin, audit `server.properties`).
- **Messages WebSocket ajoutés** : `player.session` (join/leave, jamais d'IP) et `player.lists.changed`.

## Architecture frontend

- Stores zustand : `server.store.ts` (état du serveur, logs plafonnés à `LOG_CAP` = 2000, dernier tick, sortie de backup), `auth.store.ts`, `ui.store.ts`.
- `hooks/use-websocket.ts` : connexion après authentification, reconnexion avec backoff, invalidation des queries `server`, `backups` et `metrics` à chaque reconnexion.
- Pas de `refetchInterval` sur les données poussées par WebSocket ; seul `GET /api/metrics` (courbe de fréquentation) est rafraîchi toutes les 60 s.
- i18n : `fr.json` et `en.json` ; ne pas éditer les locales à la main pour une nouvelle fonctionnalité, écrire un fragment dans `scripts/i18n-fragments/` puis lancer `merge-i18n.mjs`.
- Complétion de la console (`components/console/completion.ts`) : tout est local, RCON n'offre pas de complétion. `GRAMMAR` décrit les positions des commandes vanilla (type `player`/`item`/`block`/`entity`/`effect`/`enchantment`/`coord`/`none`, liste de littéraux, ou embranchement sur un littéral) ; les identifiants viennent de `registry.json` (généré, committé, ~50 Ko), les joueurs en ligne du store (`info.players.names`). Une position non décrite propose les joueurs. `CommandInput` : Tab / Shift+Tab cyclent, Échap masque, toute frappe recalcule.
- nginx (`Dockerfile.frontend`) proxifie `/api` et `/ws` vers `backend:3001` ; `/api/backups/download/` a un bloc dédié `^~` (pas de buffering, timeout de lecture 1 h) pour les téléchargements volumineux. Ne jamais élargir ce préfixe à `/api/backups/` : nginx répondrait à `GET /api/backups` par un 301 vers son port interne 8080 (`absolute_redirect off` limite les dégâts, mais la liste resterait redirigée).

## Invariants de sécurité (ne pas casser)

- `JWT_SECRET` et `ENCRYPTION_KEY` : obligatoires, 32+ caractères, différents, aucun défaut publié.
- JWT avec revendication `typ` (`access`, `mfa`, ...) vérifiée ; rôle rechargé en base à chaque requête dans `authMiddleware`.
- RBAC : `rbac('admin')` (403) sur start/stop/restart, commandes RCON, backup manuel, téléchargement et suppression de backups, gestion des utilisateurs. `viewer` est en lecture seule.
- Noms de backup : nom de fichier simple (pas de séparateur ni `..`) ET présent dans la liste réelle du dossier, sinon 404. Aucune traversée de chemin.
- Le volume de données est monté en lecture-écriture depuis le lot 2b ; les seules écritures sont la restauration et `server.properties`, admin, auditées, sous `DataLock`, avec un filtre d'archive strict. Le mot de passe RCON n'est jamais renvoyé, modifiable ni dupliqué dans l'environnement.
- Le socket Docker donne un accès root à l'hôte : la WebApp ne doit être exposée que derrière l'authentification (voir README).
- Le dashboard charge des avatars depuis `mc-heads.net` et les polices depuis Google Fonts : à garder documenté dans la section confidentialité du README.
- Lot 2a : les IP des joueurs et des connexions web ne sortent que par les routes `rbac('admin')` (`/api/journal/*`, fiche admin) ; `player.session` n'en porte jamais. Noms (`^[A-Za-z0-9_]{3,16}$`), IP (`net.isIP`) et raisons (une ligne, 100 caractères) sont validés dans `player-admin.ts` avant tout envoi RCON. Le lot 2a lui-même n'écrit rien dans `/data` (les écritures sont celles du lot 2b).

## Tests

vitest, backend et frontend. Pas de Docker ni de serveur RCON en test : tout passe par les fakes `DockerLike`/`RconLike`. Les tests qui ont besoin de la base utilisent `testPrisma()` (`src/test-db.ts`), qui crée une base SQLite temporaire. Les messages WebSocket, parseurs RCON (`parseList`, `parseTickQuery`, `parseTps`), `server.properties`, `BackupService` (dossier temporaire) et l'agrégation des métriques ont des tests unitaires. `archive-filter` est testé sur de vraies archives dans un dossier temporaire, `restore-service` avec les fakes Docker (arrêt simulé par événement).
