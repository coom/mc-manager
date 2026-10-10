# MC Manager, lot 1 : socle de gestion d'un serveur Minecraft Java sous Docker

Date : 2026-10-10
Statut : validé et implémenté (branche worktree-lot1-socle) ; table des routes mise à jour après la revue finale

## 1. Objectif et contexte

WebApp de suivi et de gestion d'un serveur Minecraft Java hébergé dans Docker avec
l'image `itzg/minecraft-server`, les sauvegardes étant assurées par `itzg/mc-backup`
en méthode `tar`. L'outil s'inspire de `ts6-manager` (repo voisin `../ts6-manager`),
dont il reprend la stack, la structure et le module d'authentification.

### Ce que le partenaire a demandé

- Statistiques, gestion de l'état du serveur, consultation et gestion des backups.
- Plusieurs administrateurs avec rôles, comme dans ts6-manager.
- Interface en français et en anglais.
- Backups : lister, télécharger, supprimer, déclencher manuellement, restaurer.
- Statistiques : joueurs en ligne et historique, santé du serveur (TPS, CPU, RAM,
  disque), stats par joueur, journal d'événements.
- Contrôle : start/stop/restart, console RCON et logs en direct, actions joueurs
  (kick, ban, whitelist, op), édition de `server.properties` uniquement.
- Découpage en deux lots, le socle d'abord.

### Hypothèses retenues

- Un seul serveur Minecraft à gérer.
- La WebApp tourne sur le même hôte Docker que le serveur et monte le socket Docker.
- Le conteneur Minecraft est créé et possédé par l'utilisateur (compose externe) ;
  la WebApp ne le recrée jamais, elle ne fait que le piloter.
- Version du serveur 1.20.3 ou plus pour `tick query` (MSPT). Sur un serveur Paper,
  `tps` est utilisé en complément. En dessous, le MSPT est simplement absent.

### Périmètre du lot 1

Inclus :

- Auth multi-comptes : wizard de setup du premier admin, login, MFA TOTP avec codes
  de secours, appareils de confiance, rôles `admin` et `viewer`, gestion des
  utilisateurs, politique de mot de passe.
- Contrôle du serveur : état en direct, uptime, start/stop/restart.
- Console : commandes RCON et flux de logs du conteneur en temps réel.
- Dashboard : joueurs en ligne, courbe de fréquentation 24h/7j/30j, CPU, RAM,
  MSPT/TPS, taille du monde, espace disque restant.
- Backups : liste, téléchargement, suppression, déclenchement manuel avec suivi.
- Journal d'audit des actions d'admin.
- Interface FR et EN.

Reporté au lot 2 (spec séparée) : stats par joueur, journal d'événements de jeu,
whitelist/ops/bans/kick, restauration d'un backup, éditeur de `server.properties`.

Hors périmètre, définitivement : modification de la planification des backups,
modification des variables d'environnement du conteneur, gestion de plusieurs
serveurs.

## 2. Architecture générale

Monorepo pnpm, nom de code `mc-manager`, trois packages :

| Package | Nom npm | Rôle |
|---|---|---|
| `packages/backend` | `@mc/backend` | Express + Prisma/SQLite, dockerode, client RCON, collecteur de métriques, serveur WebSocket |
| `packages/frontend` | `@mc/frontend` | SPA React 18 / Vite / Tailwind / shadcn, TanStack Query, zustand, i18next, client WebSocket |
| `packages/common` | `@mc/common` | Types et constantes partagés (messages WebSocket, DTO des routes, rôles) |

Outillage repris de ts6-manager : `tsconfig.base.json`, `eslint.config.mjs` (flat
config), vitest, `prisma.config.ts`, script de fusion i18n, CI GitHub Actions,
`Dockerfile.backend`, `Dockerfile.frontend` (nginx), `.env.example`.

### Déploiement

`docker-compose.yml` déploie la WebApp seule :

- `backend` : monte `/var/run/docker.sock`, le volume de données du serveur Minecraft
  en lecture seule sur `/mc/data`, le dossier des backups en lecture-écriture sur
  `/mc/backups`, un volume pour la base SQLite. Rejoint le réseau Docker du serveur
  Minecraft pour atteindre RCON.
- `frontend` : nginx servant la SPA et proxifiant `/api` et `/ws` vers le backend.

Variables d'environnement du backend :

| Variable | Rôle |
|---|---|
| `JWT_SECRET`, `ENCRYPTION_KEY` | obligatoires, 32 caractères minimum, différentes |
| `DATABASE_URL` | SQLite |
| `FRONTEND_URL` | origine autorisée pour CORS |
| `MC_CONTAINER` | nom du conteneur Minecraft |
| `MC_BACKUP_CONTAINER` | nom du conteneur mc-backup |
| `MC_DATA_DIR` | défaut `/mc/data` |
| `MC_BACKUPS_DIR` | défaut `/mc/backups` |
| `MC_RCON_HOST`, `MC_RCON_PORT` | défaut : `MC_CONTAINER` et 25575 |

Le mot de passe RCON est lu dans `server.properties` sur le volume monté ; il n'est
jamais dupliqué dans l'environnement de la WebApp.

`docker-compose.example.yml` montre une stack complète de référence avec
`itzg/minecraft-server`, `itzg/mc-backup` (méthode tar) et la WebApp.

### Rôles

- `viewer` : lecture seule sur dashboard, console (logs uniquement), backups
  (liste), audit.
- `admin` : tout, y compris start/stop/restart, commandes RCON, backup manuel,
  téléchargement et suppression de backups, gestion des utilisateurs.

## 3. Backend

### Démarrage

`src/index.ts` : validation de `config.ts` à l'import, Prisma, `createApp()`,
serveur HTTP partagé avec le `WebSocketServer` sur `/ws`, puis démarrage des
services. Pas de conteneur d'injection : chaque service est exposé via
`req.app.locals.{prisma, docker, rcon, metrics, backups, logs, wss}`.

### Services

**DockerService** (`src/docker/docker-service.ts`)

- Wrapper de `dockerode` sur le socket Docker.
- Résout `MC_CONTAINER` et `MC_BACKUP_CONTAINER` par nom à chaque usage (pas de
  cache d'identifiant, un conteneur recréé doit fonctionner sans redémarrage).
- Écoute le flux d'événements Docker filtré sur ces deux conteneurs (`start`, `die`,
  `health_status`) et maintient en mémoire l'état du serveur.
- États exposés : `unavailable` (socket ou conteneur introuvable), `stopped`,
  `starting` (conteneur `running`, santé `starting`), `ready` (santé `healthy`),
  `unhealthy`, `stopping`. La santé vient du healthcheck `mc-health` intégré à
  l'image itzg. Uptime = `State.StartedAt`.
- Opérations : `start()`, `stop()` (timeout 60 s pour laisser le serveur sauvegarder),
  `restart()`, `stats()` (un tick du flux `stats` : CPU %, mémoire utilisée/limite),
  `logs(since)` (flux), `exec(container, cmd)` (flux stdout/stderr).

**RconService** (`src/rcon/rcon-service.ts`)

- Une connexion TCP persistante (lib `rcon-client`), établie seulement quand l'état
  est `ready`, fermée sur `stopped`/`die`, reconnexion avec backoff exponentiel
  (1 s à 30 s).
- File de commandes séquentielle avec timeout de 10 s par commande.
- `send(cmd)` renvoie la réponse brute. Les parseurs vivent dans `src/rcon/parsers.ts`
  (`parseList`, `parseTickQuery`, `parseTps`) et sont testés unitairement.

**MetricsCollector** (`src/metrics/collector.ts`)

- Tick toutes les 15 s. Si l'état est `ready` : `list` (nombre et noms des joueurs),
  `tick query` (MSPT moyen) et `tps` si disponible, plus CPU/RAM Docker. Sinon
  seulement l'état.
- Toutes les 5 min : taille du dossier `world` (parcours récursif, async) et espace
  libre du système de fichiers `MC_DATA_DIR`.
- Chaque tick écrit une ligne `MetricSample` et diffuse `metrics.tick` en WebSocket.
- Tâche horaire : agrège les `MetricSample` de l'heure écoulée en `MetricHourly`
  (moyenne et max des joueurs, CPU, RAM, MSPT), puis purge les échantillons bruts de
  plus de 48 h. Les lignes horaires sont conservées 400 jours.
- Les séries servies par l'API : 24 h depuis `MetricSample` (pas de 15 s, réduit à
  1 min côté API), 7 j et 30 j depuis `MetricHourly`.

**BackupService** (`src/backups/backup-service.ts`)

- `list()` : lit `MC_BACKUPS_DIR`, ne retient que les fichiers réguliers `*.tgz`
  et `*.tar.gz`, renvoie nom, taille, mtime, triés du plus récent au plus ancien,
  plus le total occupé.
- `download(name)` et `remove(name)` : `name` doit être un nom de fichier simple
  (pas de séparateur, pas de `..`) et exister dans la liste ; sinon 404.
- `runNow()` : `docker exec <MC_BACKUP_CONTAINER> backup now`, sortie diffusée ligne
  par ligne en `backup.progress`, puis `backup.done` avec code de sortie. Un seul
  backup manuel à la fois (409 sinon). Après succès, la liste est rafraîchie.

**LogStreamer** (`src/logs/log-streamer.ts`)

- Un seul abonnement au flux de logs Docker du conteneur Minecraft, rouvert à chaque
  `start`.
- Tampon circulaire des 500 dernières lignes, envoyé à chaque client WebSocket à la
  connexion, puis diffusion de chaque nouvelle ligne en `log.line`.
- Chaque ligne est parsée en `{ ts, level, thread, message }` quand elle suit le
  format standard `[HH:MM:SS] [thread/LEVEL]: message`, sinon niveau `RAW`.

### Modèles Prisma

Portés de ts6-manager : `User`, `RefreshToken`, `TrustedDevice`, `AppSetting`.
Le modèle `UserServerAccess` n'est pas porté (un seul serveur).

Nouveaux :

```prisma
model MetricSample {
  id          Int      @id @default(autoincrement())
  at          DateTime @default(now())
  status      String
  players     Int?
  playerNames String?  // JSON string[]
  cpuPercent  Float?
  memUsed     BigInt?
  memLimit    BigInt?
  mspt        Float?
  tps         Float?
  worldBytes  BigInt?
  diskFree    BigInt?
  @@index([at])
}

model MetricHourly {
  hour        DateTime @id
  playersAvg  Float
  playersMax  Int
  cpuAvg      Float?
  memAvg      BigInt?
  msptAvg     Float?
  msptMax     Float?
  worldBytes  BigInt?
  samples     Int
}

model AuditLog {
  id        Int      @id @default(autoincrement())
  at        DateTime @default(now())
  userId    Int
  username  String
  action    String   // server.start, server.stop, server.restart, rcon.command,
                     // backup.run, backup.delete, backup.download, user.*
  detail    String?  // commande RCON, nom du backup, etc.
  ip        String?
  @@index([at])
}
```

Comme dans ts6-manager, `schema.prisma` est la source de vérité ; en production le
conteneur applique `prisma db push --skip-generate` au démarrage.

### Routes HTTP

Publiques : `GET /api/health`, `/api/setup/*`, `/api/auth/*`.

Derrière `authMiddleware` (JWT `typ: access`, rôle rechargé en base à chaque
requête) :

| Route | Rôle | Description |
|---|---|---|
| `GET /api/server` | viewer | état, uptime, version lue dans les logs/`server.properties`, stats instantanées |
| `POST /api/server/start`, `/stop`, `/restart` | admin | 202, l'état suit en WebSocket |
| `POST /api/server/command` | admin | `{ command }`, renvoie `{ response }` ; journalisé |
| `GET /api/metrics?range=24h|7d|30d` | viewer | séries temporelles |
| `GET /api/backups` | viewer | liste |
| `POST /api/backups/:name/link` | admin | émet un lien de téléchargement à usage unique (60 s), audité |
| `GET /api/backups/download/:token` | public (token) | streaming du fichier ; 404 si token inconnu, expiré ou déjà utilisé |
| `DELETE /api/backups/:name` | admin | |
| `POST /api/backups/run` | admin | 202 ou 409 si déjà en cours |
| `GET /api/audit?page&action&user` | viewer | paginé |
| `/api/users/*` | admin | porté de ts6-manager |
| `/api/auth/me`, `/api/auth/password`, `/api/auth/mfa/*`, `/api/auth/trusted*`, `/api/auth/language` | tout utilisateur | compte, MFA, appareils, langue (routes portées de ts6-manager telles quelles) |

Le middleware `rbac('admin')` refuse en 403. Toute action d'admin écrit une ligne
`AuditLog` avant de répondre.

### WebSocket

- Handshake authentifié par le JWT d'accès (query ou cookie), fermé en 4401 sinon.
- Serveur vers client : `server.status`, `log.line`, `metrics.tick`,
  `backup.progress`, `backup.done`, `backup.list.changed`.
- Client vers serveur : aucun message. Les commandes RCON passent par HTTP pour être
  journalisées et contrôlées par rôle.
- Types des messages dans `@mc/common`.

### Gestion des erreurs

- Socket Docker inaccessible ou conteneur introuvable : état `unavailable`, message
  explicite dans `GET /api/server`, les actions répondent 503. Le backend ne plante
  pas et réessaie l'écoute des événements avec backoff.
- RCON indisponible : `POST /api/server/command` répond 503, le collecteur saute les
  champs RCON du tick.
- `backup now` en échec : `backup.done` avec code non nul, ligne d'audit avec le
  détail.
- Erreurs inattendues : `error-handler.ts` porté de ts6-manager, pino pour les logs.

## 4. Frontend

### Pages

- **Setup** et **Login** : portées de ts6-manager (wizard, login, MFA, appareil de
  confiance, changement de mot de passe forcé).
- **Dashboard** : bandeau d'état avec uptime et boutons start/stop/restart
  (confirmation sur stop et restart) ; tuiles joueurs en ligne, CPU, RAM, MSPT/TPS,
  taille du monde, disque restant ; liste des joueurs connectés ; courbe de
  fréquentation avec sélecteur 24h/7j/30j (recharts).
- **Console** : flux de logs avec pause, filtre texte et niveau, auto-scroll ;
  champ de commande RCON avec historique (flèches haut/bas) et réponse inline. Le
  champ est absent pour un `viewer`.
- **Backups** : tableau (nom, date, taille, âge), total occupé, bouton "Backup
  maintenant" avec sortie en direct dans un panneau, téléchargement, suppression
  avec confirmation.
- **Audit** : tableau paginé et filtrable.
- **Utilisateurs** et **Compte** : portées de ts6-manager.

### Données et temps réel

- TanStack Query pour toutes les requêtes HTTP.
- Store zustand `serverStore` alimenté par le WebSocket : état du serveur, tampon
  de logs (plafonné à 2 000 lignes), dernier tick de métriques, progression de
  backup.
- Hook `useWebSocket` : connexion à l'authentification, reconnexion avec backoff,
  invalidation des queries `server`, `backups` et `metrics` à chaque reconnexion.
- Aucun `refetchInterval` sur les données poussées ; seul `GET /api/metrics` est
  rafraîchi toutes les 60 s pour les courbes.

### i18n

i18next + `react-i18next`, locales `fr.json` et `en.json`, détection navigateur
puis préférence utilisateur stockée côté serveur. Script
`scripts/merge-i18n.mjs` repris de ts6-manager, adapté à deux locales, échoue si
les clés divergent de `en.json`.

### Design

Interface sombre par défaut avec bascule claire, shadcn/ui, lucide-react. Pas de
dépendance à `@xyflow/react`, `flag-icons` ni aux bibliothèques audio de
ts6-manager.

## 5. Sécurité

- Invariants portés de ts6-manager : JWT avec revendication `typ`, refresh tokens
  avec rotation et détection de réutilisation, `helmet`, CORS restreint à
  `FRONTEND_URL`, rate-limit sur `/api/auth/login` et `/api/setup`, bcrypt, secrets
  chiffrés avec `ENCRYPTION_KEY` (TOTP).
- Les commandes RCON sont transmises telles quelles, mais uniquement par un admin,
  et journalisées dans `AuditLog` avec l'utilisateur et l'IP.
- Les noms de backup sont validés comme nom de fichier simple et vérifiés contre la
  liste réelle du dossier : aucune traversée de chemin possible.
- Le volume de données est monté en lecture seule dans le lot 1.
- Le socket Docker donne un accès root à l'hôte : la WebApp ne doit être exposée
  que derrière l'authentification, et la documentation le rappelle.

## 6. Tests

Backend (vitest) :

- Parseurs : `server.properties`, `parseList`, `parseTickQuery`, `parseTps`,
  parseur de ligne de log.
- `BackupService` : listing, tri, validation des noms, refus de traversée, verrou
  "un seul backup à la fois", contre un dossier temporaire.
- `MetricsCollector` : agrégation horaire et purge, contre une base SQLite de test.
- Middlewares `auth` et `rbac`.
- `DockerService` et `RconService` testés contre des fakes injectés (interfaces
  `DockerLike`, `RconLike`), pas de Docker en CI.

Frontend (vitest + Testing Library) :

- `serverStore` : réduction des messages WebSocket, plafond du tampon de logs.
- Composant Console : filtre, pause, historique de commandes.
- Formatage des métriques (octets, durées, MSPT).

CI GitHub Actions : `pnpm install --frozen-lockfile`, `pnpm audit --audit-level
high`, `db:generate`, build de common, lint, typecheck, test, build, build des
deux Dockerfiles.

## 7. Structure du dépôt

```
mc-manager/
  package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.mjs
  docker-compose.yml, docker-compose.example.yml, docker-compose.dev.yml
  Dockerfile.backend, Dockerfile.frontend, .env.example
  .github/workflows/ci.yml
  docs/superpowers/{specs,plans}/
  packages/
    common/src/{index.ts, ws-messages.ts, api-types.ts, roles.ts}
    backend/
      prisma/schema.prisma, prisma.config.ts
      src/
        index.ts, app.ts, config.ts
        auth/, middleware/, routes/{auth,setup,users,me,server,metrics,backups,audit}.routes.ts
        docker/docker-service.ts
        rcon/{rcon-service.ts, parsers.ts}
        metrics/{collector.ts, aggregate.ts}
        backups/backup-service.ts
        logs/{log-streamer.ts, parse-line.ts}
        audit/audit.ts
        ws/{ws-server.ts, ws-broadcast.ts}
        utils/{server-properties.ts, crypto.ts, logger.ts}
    frontend/
      src/{api, components/{ui,layout,shared,dashboard,console,backups}, hooks, i18n, pages, stores, lib}
      scripts/merge-i18n.mjs
```

## 8. Ordre de construction suggéré

1. Squelette du monorepo, outillage, CI, Dockerfiles, `@mc/common`.
2. Port de l'auth (schéma, routes, middlewares, pages Setup/Login/Compte/Utilisateurs).
3. `DockerService` + état du serveur + routes `server` + bandeau Dashboard.
4. `LogStreamer` + WebSocket + page Console (logs).
5. `RconService` + parseurs + commande RCON dans la Console.
6. `MetricsCollector` + agrégation + routes `metrics` + tuiles et courbe du Dashboard.
7. `BackupService` + page Backups.
8. `AuditLog` + page Audit.
9. Compose de déploiement, compose d'exemple, README FR/EN.
