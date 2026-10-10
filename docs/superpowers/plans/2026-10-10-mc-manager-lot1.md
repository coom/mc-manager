# MC Manager lot 1 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le socle de MC Manager : auth multi-comptes, pilotage Docker du serveur Minecraft, console RCON et logs en direct, métriques avec historique, gestion des backups tar et journal d'audit.

**Architecture:** Monorepo pnpm à trois packages (`@mc/common`, `@mc/backend`, `@mc/frontend`) calqué sur `../ts6-manager`. Le backend Express expose des services via `app.locals` (DockerService, RconService, MetricsCollector, BackupService, LogStreamer) et pousse l'état au frontend par WebSocket. Le frontend React consomme l'API par TanStack Query et le WebSocket par un store zustand.

**Tech Stack:** Node 22, pnpm 9, TypeScript 5.9, Express 4, Prisma 6 + SQLite, dockerode, rcon-client, ws, vitest ; React 18, Vite 6, Tailwind 3, shadcn/ui, TanStack Query 5, zustand 5, i18next, recharts, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-10-mc-manager-lot1-design.md`

**Source de portage :** `C:\Workspace\ts6-manager` (chemin relatif `../ts6-manager` depuis la racine du projet). Les tâches de portage nomment les fichiers à copier et les modifications à faire. Partout, remplacer l'import `@ts6/common` par `@mc/common`, les préfixes `ts6` par `mc` et la clé localStorage `ts6-auth` par `mc-auth`, `ts6-ui` par `mc-ui`, `ts6_lang` par `mc_lang`, le cookie `ts6_trusted` par `mc_trusted`.

## Global Constraints

- Node `>=20` (CI et Docker en 22), pnpm `>=9`. ESM partout (`"type": "module"`), imports relatifs avec extension `.js` dans le backend.
- Le backend refuse de démarrer sans `JWT_SECRET` et `ENCRYPTION_KEY` (32 caractères minimum, différents).
- Deux rôles exactement : `admin` et `viewer`. Un `viewer` ne déclenche aucune action.
- Le volume `/mc/data` est monté en lecture seule. Le backend ne l'écrit jamais.
- Le mot de passe RCON est lu dans `server.properties`, jamais dans l'environnement.
- Les noms de backup acceptés sont des noms de fichier simples existant dans `MC_BACKUPS_DIR`, extension `.tgz` ou `.tar.gz`.
- Un seul backup manuel à la fois (409 sinon).
- Toute action d'admin écrit une ligne `AuditLog`.
- Le frontend ne sollicite jamais l'API en `refetchInterval` pour ce que le WebSocket pousse ; seule la query `metrics` se rafraîchit toutes les 60 s.
- Locales `fr` et `en`, parité des clés vérifiée par `merge-i18n.mjs`.
- Aucun test ne requiert Docker, RCON ni un serveur Minecraft : Docker et RCON sont derrière les interfaces `DockerLike` et `RconLike` et remplacés par des fakes.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` passent à la fin de chaque tâche.

## Review Focus

1. Conteneur Minecraft avec `tty: true` (cas courant dans les compose itzg) : le flux de logs Docker n'est alors pas multiplexé ; `LogStreamer` doit lire `Config.Tty` et ne démultiplexer que si `false`, sinon les lignes arrivent corrompues. Test ajouté en tâche 9.
2. Réponse RCON de `tick query` sur une version sans cette commande (< 1.20.3) : le serveur répond `Unknown or incomplete command`. `parseTickQuery` doit renvoyer `null` et le collecteur doit stocker `mspt: null`, pas planter ni stocker 0. Test ajouté en tâche 11.
3. Conteneur recréé (nouvel identifiant) pendant que la WebApp tourne : `DockerService` doit résoudre par nom à chaque appel et le flux d'événements doit filtrer par nom, pas par identifiant. Test ajouté en tâche 7.
4. Nom de backup avec traversée (`../x.tgz`), encodé (`%2e%2e`) ou absent du dossier : `BackupService` renvoie 404 sans toucher au système de fichiers hors du dossier. Tests ajoutés en tâche 14.
5. Reconnexion WebSocket après expiration du JWT : `useWebSocket` doit rafraîchir le token avant de se reconnecter, sinon boucle de 4401. Test ajouté en tâche 8.

## Structure des fichiers

```
mc-manager/
  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  .gitignore  .dockerignore  .env.example
  .github/workflows/ci.yml
  Dockerfile.backend  Dockerfile.frontend  docker-compose.yml  docker-compose.example.yml
  packages/common/src/
    index.ts                 réexports
    types/auth.ts            UserRole, TokenType, JwtPayload (porté)
    types/server.ts          ServerStatus, ServerInfo, ServerStats
    types/metrics.ts         MetricPoint, MetricsRange
    types/backups.ts         BackupEntry, BackupList
    types/audit.ts           AuditEntry, AuditAction
    ws-messages.ts           union WsMessage
  packages/backend/
    prisma/schema.prisma  prisma/seed.ts  prisma.config.ts  vitest.config.ts  tsconfig.json
    src/config.ts  src/index.ts  src/app.ts  src/test-setup.ts
    src/auth/session.ts
    src/middleware/{auth,rbac,error-handler}.ts
    src/routes/{auth,setup,users,server,metrics,backups,audit}.routes.ts
    src/utils/{crypto,mfa,validate-password,trusted-device,trusted-device-service,server-properties,logger}.ts
    src/audit/audit.ts
    src/docker/{docker-like.ts,docker-service.ts,fake-docker.ts}
    src/logs/{parse-line.ts,log-streamer.ts}
    src/rcon/{rcon-like.ts,parsers.ts,rcon-service.ts}
    src/metrics/{collector.ts,aggregate.ts,series.ts}
    src/backups/backup-service.ts
    src/ws/{ws-server.ts,ws-broadcast.ts}
  packages/frontend/
    index.html  vite.config.ts  tailwind.config.ts  postcss.config.js  components.json  tsconfig.json  vitest.config.ts
    scripts/merge-i18n.mjs  scripts/i18n-fragments/
    src/main.tsx  src/App.tsx  src/styles/globals.css  src/lib/utils.ts  src/lib/format.ts
    src/i18n/index.ts  src/i18n/locales/{en,fr}.json
    src/api/{client,token-refresh,auth.api,users.api,server.api,metrics.api,backups.api,audit.api}.ts
    src/stores/{auth.store,ui.store,server.store}.ts
    src/hooks/{use-auth,use-websocket}.ts
    src/components/ui/*  (shadcn, copiés)
    src/components/layout/{AppLayout,Header,Sidebar}.tsx
    src/components/shared/{ConfirmDialog,DataTable,EmptyState,LanguageSwitcher,LoadingSpinner,ThemeToggle}.tsx
    src/components/dashboard/{StatusBanner,StatTiles,PlayersCard,PlayersChart}.tsx
    src/components/console/{LogView,CommandInput}.tsx
    src/components/backups/{BackupTable,BackupRunPanel}.tsx
    src/pages/{Login,SetupPage,Dashboard,Console,Backups,Audit,Settings,NotFound}.tsx
```

---

### Task 1 : squelette du monorepo et package common

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `.dockerignore`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/common/package.json`, `packages/common/tsconfig.json`, `packages/common/src/index.ts`, `packages/common/src/types/auth.ts`

**Interfaces:**
- Produces: package `@mc/common` importable par le backend et le frontend ; scripts racine `dev`, `build`, `lint`, `typecheck`, `test`, `db:generate`.

- [ ] **Step 1 : copier l'outillage racine depuis ts6-manager**

```bash
cd /c/Workspace/Minecraft
cp ../ts6-manager/pnpm-workspace.yaml ../ts6-manager/tsconfig.base.json ../ts6-manager/.dockerignore .
mkdir -p .github/workflows packages/common/src/types
```

- [ ] **Step 2 : écrire `package.json` racine**

```json
{
  "name": "mc-manager",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel -r run dev",
    "dev:backend": "pnpm --filter @mc/backend run dev",
    "dev:frontend": "pnpm --filter @mc/frontend run dev",
    "build": "pnpm -r run build",
    "db:generate": "pnpm --filter @mc/backend exec prisma generate",
    "db:push": "pnpm --filter @mc/backend exec prisma db push",
    "lint": "eslint .",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "eslint": "^10.4.1",
    "eslint-plugin-react-hooks": "^7.1.1",
    "globals": "^17.6.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.61.0"
  },
  "engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }
}
```

- [ ] **Step 3 : écrire `eslint.config.mjs`**

Copier `../ts6-manager/eslint.config.mjs` puis : retirer `'packages/sidecar/**'` des `ignores`, retirer la règle `'@typescript-eslint/no-unsafe-declaration-merging': 'off'`, et passer `'@typescript-eslint/no-explicit-any'` à `'warn'` (le nouveau code est typé ; seul le code porté en a).

- [ ] **Step 4 : écrire `.gitignore`**

```
node_modules/
dist/
*.tsbuildinfo
.env
*.db
*.db-journal
*.log
.DS_Store
.vscode/
.idea/
packages/backend/generated/
packages/backend/data/
packages/backend/prisma/migrations/
.superpowers/
```

- [ ] **Step 5 : écrire `.env.example`**

```
NODE_ENV=development
PORT=3001
DATABASE_URL="file:./data/mc-manager.db"
# Obligatoires, 32 caractères minimum, différents l'un de l'autre : openssl rand -hex 32
JWT_SECRET=change-this-to-a-random-string-at-least-32-chars
ENCRYPTION_KEY=change-this-to-a-different-random-string
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
# Origine exacte utilisée par le navigateur (valeur CORS)
FRONTEND_URL=http://localhost:5173
FRONTEND_PORT=3000

# Serveur Minecraft
MC_CONTAINER=mc
MC_BACKUP_CONTAINER=mc-backup
MC_DATA_DIR=/mc/data
MC_BACKUPS_DIR=/mc/backups
# Défaut : MC_CONTAINER et 25575
MC_RCON_HOST=
MC_RCON_PORT=25575
DOCKER_SOCKET=/var/run/docker.sock
```

- [ ] **Step 6 : écrire `packages/common/package.json` et `tsconfig.json`**

Copier `../ts6-manager/packages/common/package.json` et `tsconfig.json`, renommer `"name"` en `@mc/common`, ajouter `"test": "echo no tests"` dans `scripts`.

- [ ] **Step 7 : écrire `packages/common/src/types/auth.ts` et `index.ts`**

```ts
// packages/common/src/types/auth.ts
export type UserRole = 'admin' | 'viewer';
export type TokenType = 'access' | 'mfa' | 'pwchange';
export interface JwtPayload {
  id: number;
  username: string;
  role: UserRole;
  typ?: TokenType;
  iat?: number;
  exp?: number;
}
```

```ts
// packages/common/src/index.ts
export * from './types/auth.js';
```

- [ ] **Step 8 : écrire la CI `.github/workflows/ci.yml`**

Copier `../ts6-manager/.github/workflows/ci.yml`, puis : `branches: [main]`, supprimer le job `sidecar`, remplacer `@ts6/common` par `@mc/common`, et dans le job `docker` mettre `dockerfile: [Dockerfile.backend, Dockerfile.frontend]`.

- [ ] **Step 9 : installer et vérifier**

```bash
pnpm install
pnpm --filter @mc/common run build
pnpm lint
```

Attendu : build de common sans erreur, lint sans erreur.

- [ ] **Step 10 : commit**

```bash
git add -A
git commit -m "chore: squelette du monorepo et package common"
```

---

### Task 2 : bootstrap du backend (config, Prisma, app, index)

**Files:**
- Create: `packages/backend/package.json`, `tsconfig.json`, `vitest.config.ts`, `prisma.config.ts`, `prisma/schema.prisma`, `prisma/seed.ts`
- Create: `packages/backend/src/config.ts`, `src/test-setup.ts`, `src/app.ts`, `src/index.ts`, `src/middleware/error-handler.ts`, `src/utils/logger.ts`
- Test: `packages/backend/src/config.test.ts`

**Interfaces:**
- Produces: `config` (`port, nodeEnv, databaseUrl, jwtSecret, encryptionKey, jwtAccessExpiry, jwtRefreshExpiry, frontendUrl, mc: { container, backupContainer, dataDir, backupsDir, rconHost, rconPort, dockerSocket }`), `createApp(): Express`, `AppError(statusCode, message, details?)`, `logger` (pino).

- [ ] **Step 1 : écrire `packages/backend/package.json`**

```json
{
  "name": "@mc/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mc/common": "workspace:*",
    "@prisma/client": "^6.19.3",
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "dockerode": "^4.0.9",
    "dotenv": "^16.6.1",
    "express": "^4.22.2",
    "express-rate-limit": "^7.5.1",
    "helmet": "^8.2.0",
    "jsonwebtoken": "^9.0.3",
    "nanoid": "^5.1.11",
    "otplib": "^12.0.1",
    "pino": "^9.14.0",
    "pino-pretty": "^11.3.0",
    "qrcode": "^1.5.4",
    "rcon-client": "^4.2.5",
    "ws": "^8.21.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/dockerode": "^3.3.34",
    "@types/express": "^5.0.6",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^22.19.21",
    "@types/qrcode": "^1.5.6",
    "@types/ws": "^8.18.1",
    "prisma": "^6.19.3",
    "tsx": "^4.22.4",
    "typescript": "^5.9.3",
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2 : copier la config TypeScript, vitest et Prisma CLI**

```bash
cd /c/Workspace/Minecraft
cp ../ts6-manager/packages/backend/tsconfig.json ../ts6-manager/packages/backend/vitest.config.ts ../ts6-manager/packages/backend/prisma.config.ts packages/backend/
mkdir -p packages/backend/src/middleware packages/backend/src/utils packages/backend/prisma
cp ../ts6-manager/packages/backend/src/test-setup.ts packages/backend/src/
```

- [ ] **Step 3 : écrire `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../generated/prisma"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id                 Int       @id @default(autoincrement())
  username           String    @unique
  passwordHash       String?
  displayName        String
  role               String    @default("viewer")
  enabled            Boolean   @default(true)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  lastLoginAt        DateTime?
  mfaEnabled         Boolean   @default(false)
  mfaSecret          String?
  mfaPendingSecret   String?
  mfaRecoveryCodes   String?
  mfaRequired        Boolean   @default(false)
  mustChangePassword Boolean   @default(false)
  language           String?

  refreshTokens  RefreshToken[]
  trustedDevices TrustedDevice[]
}

model RefreshToken {
  id         Int      @id @default(autoincrement())
  token      String   @unique
  userId     Int
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  family     String?
  replacedBy String?
}

model TrustedDevice {
  id           Int      @id @default(autoincrement())
  userId       Int
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  selector     String   @unique
  verifierHash String
  expiresAt    DateTime
  createdAt    DateTime @default(now())
  lastUsedAt   DateTime @default(now())
  userAgent    String?
  ipAddress    String?
}

model AppSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}

model MetricSample {
  id          Int      @id @default(autoincrement())
  at          DateTime @default(now())
  status      String
  players     Int?
  playerNames String?
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
  hour       DateTime @id
  playersAvg Float
  playersMax Int
  cpuAvg     Float?
  memAvg     BigInt?
  msptAvg    Float?
  msptMax    Float?
  worldBytes BigInt?
  samples    Int
}

model AuditLog {
  id       Int      @id @default(autoincrement())
  at       DateTime @default(now())
  userId   Int
  username String
  action   String
  detail   String?
  ip       String?

  @@index([at])
}
```

Note : `passwordHash` reste nullable pour porter `auth.routes.ts` tel quel (les gardes `requirePasswordHash` et `canLocalLogin` restent valables). Les colonnes `authProvider` et `externalId` ne sont pas portées.

- [ ] **Step 4 : écrire `prisma/seed.ts`**

```ts
import { PrismaClient } from '../generated/prisma/index.js';
const prisma = new PrismaClient();
async function main() {
  console.log('Seed: nothing to seed. Visit /setup to create the admin account.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
```

- [ ] **Step 5 : écrire le test de `config.ts`**

```ts
// packages/backend/src/config.test.ts
import { describe, it, expect } from 'vitest';
import { buildMcConfig } from './config.js';

describe('buildMcConfig', () => {
  it('defaults rconHost to the container name and rconPort to 25575', () => {
    const mc = buildMcConfig({ MC_CONTAINER: 'mc', MC_BACKUP_CONTAINER: 'mc-backup' });
    expect(mc.rconHost).toBe('mc');
    expect(mc.rconPort).toBe(25575);
    expect(mc.dataDir).toBe('/mc/data');
    expect(mc.backupsDir).toBe('/mc/backups');
    expect(mc.dockerSocket).toBe('/var/run/docker.sock');
  });
  it('honours explicit overrides', () => {
    const mc = buildMcConfig({ MC_CONTAINER: 'srv', MC_BACKUP_CONTAINER: 'bk', MC_RCON_HOST: '10.0.0.2', MC_RCON_PORT: '25999', MC_DATA_DIR: '/d', MC_BACKUPS_DIR: '/b', DOCKER_SOCKET: '/x.sock' });
    expect(mc).toEqual({ container: 'srv', backupContainer: 'bk', rconHost: '10.0.0.2', rconPort: 25999, dataDir: '/d', backupsDir: '/b', dockerSocket: '/x.sock' });
  });
  it('throws when MC_CONTAINER is missing', () => {
    expect(() => buildMcConfig({ MC_BACKUP_CONTAINER: 'bk' })).toThrow(/MC_CONTAINER/);
  });
});
```

- [ ] **Step 6 : lancer le test, vérifier l'échec**

```bash
pnpm --filter @mc/backend exec vitest run src/config.test.ts
```

Attendu : FAIL, `buildMcConfig` introuvable.

- [ ] **Step 7 : écrire `src/config.ts`**

Copier `../ts6-manager/packages/backend/src/config.ts`, retirer `tsAllowSelfSigned`, remplacer le nom de base par `file:./data/mc-manager.db`, et ajouter :

```ts
export interface McConfig {
  container: string;
  backupContainer: string;
  rconHost: string;
  rconPort: number;
  dataDir: string;
  backupsDir: string;
  dockerSocket: string;
}

export function buildMcConfig(env: Record<string, string | undefined>): McConfig {
  const container = env.MC_CONTAINER?.trim();
  if (!container) throw new Error('MC_CONTAINER is not set');
  const backupContainer = env.MC_BACKUP_CONTAINER?.trim();
  if (!backupContainer) throw new Error('MC_BACKUP_CONTAINER is not set');
  const port = parseInt(env.MC_RCON_PORT || '25575', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MC_RCON_PORT is invalid');
  return {
    container,
    backupContainer,
    rconHost: env.MC_RCON_HOST?.trim() || container,
    rconPort: port,
    dataDir: env.MC_DATA_DIR || '/mc/data',
    backupsDir: env.MC_BACKUPS_DIR || '/mc/backups',
    dockerSocket: env.DOCKER_SOCKET || '/var/run/docker.sock',
  };
}

function loadMc(): McConfig {
  try {
    return buildMcConfig(process.env);
  } catch (err) {
    console.error(`[FATAL] ${(err as Error).message}`);
    process.exit(1);
  }
}

export const config = {
  /* ...champs portés... */
  mc: loadMc(),
};
```

Ajouter dans `src/test-setup.ts` : `process.env.MC_CONTAINER ||= 'mc'; process.env.MC_BACKUP_CONTAINER ||= 'mc-backup';`.

- [ ] **Step 8 : lancer le test, vérifier le succès**

```bash
pnpm --filter @mc/backend exec vitest run src/config.test.ts
```

Attendu : 3 tests PASS.

- [ ] **Step 9 : écrire `src/middleware/error-handler.ts` et `src/utils/logger.ts`**

Copier `../ts6-manager/packages/backend/src/middleware/error-handler.ts` en retirant la classe `TSApiError` et sa branche.

```ts
// src/utils/logger.ts
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
```

- [ ] **Step 10 : écrire `src/app.ts`**

```ts
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, please try again later' } });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/refresh', authLimiter);
  app.use('/api/setup/init', authLimiter);
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } }));

  // Les routes sont montées ici par les tâches suivantes, dans cet ordre :
  // publiques (/api/setup, /api/auth), puis app.use('/api', authMiddleware), puis les routes protégées.

  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 11 : écrire `src/index.ts` minimal**

```ts
import { createServer } from 'http';
import { PrismaClient } from '../generated/prisma/index.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

process.on('uncaughtException', (err) => logger.error({ err }, 'uncaught exception (kept alive)'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection (kept alive)'));

async function main() {
  if (config.encryptionKey === config.jwtSecret) {
    logger.fatal('ENCRYPTION_KEY must be different from JWT_SECRET');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const app = createApp();
  const server = createServer(app);
  app.locals.prisma = prisma;

  server.listen(config.port, () => logger.info(`MC Manager backend on http://localhost:${config.port}`));

  const shutdown = async () => {
    logger.info('shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { logger.fatal({ err }, 'failed to start'); process.exit(1); });
```

- [ ] **Step 12 : générer, typer, tester**

```bash
pnpm install
pnpm db:generate
pnpm --filter @mc/backend run typecheck
pnpm --filter @mc/backend run test
```

Attendu : typecheck sans erreur, tests PASS.

- [ ] **Step 13 : commit**

```bash
git add -A
git commit -m "feat(backend): bootstrap Express, Prisma et configuration"
```

---
### Task 3 : portage de l'authentification backend

**Files:**
- Create (copiés depuis `../ts6-manager/packages/backend/src/`) : `utils/crypto.ts` (+ `.test.ts`), `utils/mfa.ts` (+ `.test.ts`), `utils/validate-password.ts` (+ `.test.ts`), `utils/trusted-device.ts` (+ `.test.ts`), `utils/trusted-device-service.ts` (+ `.test.ts`), `auth/session.ts`, `middleware/auth.ts` (+ `.test.ts`), `middleware/rbac.ts`, `routes/auth.routes.ts`, `routes/setup.routes.ts`, `routes/users.routes.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `authMiddleware`, `requireRole('admin')`, `req.user: JwtPayload`, routes `/api/setup/*`, `/api/auth/*`, `/api/users/*` identiques à ts6-manager (voir la liste des endpoints dans `auth.routes.ts`).

- [ ] **Step 1 : copier les fichiers**

```bash
cd /c/Workspace/Minecraft/packages/backend/src
S=../../../../ts6-manager/packages/backend/src
mkdir -p auth routes
cp $S/utils/{crypto,mfa,validate-password,trusted-device,trusted-device-service}.ts utils/
cp $S/utils/{crypto,mfa,validate-password,trusted-device,trusted-device-service}.test.ts utils/
cp $S/auth/session.ts auth/
cp $S/middleware/{auth,rbac}.ts $S/middleware/auth.test.ts middleware/
cp $S/routes/{auth,setup,users}.routes.ts routes/
```

- [ ] **Step 2 : adapter les imports et retirer les dépendances TeamSpeak**

Dans tous les fichiers copiés : `@ts6/common` → `@mc/common`.

Dans `utils/trusted-device.ts` : `TRUSTED_COOKIE_NAME = 'mc_trusted'`.

Dans `routes/auth.routes.ts` :
- supprimer l'import `isIpWebBanned` et les deux appels (ligne `if (await isIpWebBanned(...))` dans `trustedLoginAllowed` et dans `/login`) ;
- supprimer `const journal = req.app.locals.connectionJournal;` et tout appel `journal?.…` ;
- supprimer les routes et imports liés à SAML s'il en reste (aucune route SAML n'est dans ce fichier, seuls des commentaires).

Dans `routes/users.routes.ts` : rien à changer.

- [ ] **Step 3 : monter les routes dans `src/app.ts`**

Après les limiteurs :

```ts
import { authMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { setupRoutes } from './routes/setup.routes.js';
import { userRoutes } from './routes/users.routes.js';
// ...
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', authMiddleware);
app.use('/api/users', userRoutes);
```

- [ ] **Step 4 : typecheck et tests**

```bash
pnpm --filter @mc/backend run typecheck
pnpm --filter @mc/backend run test
```

Attendu : typecheck propre ; tests `crypto`, `mfa`, `validate-password`, `trusted-device`, `trusted-device-service`, `auth` middleware tous PASS.

- [ ] **Step 5 : test manuel du wizard**

```bash
cp .env.example .env   # puis remplacer les deux secrets par openssl rand -hex 32
pnpm --filter @mc/backend exec prisma db push
pnpm dev:backend
curl -s localhost:3001/api/setup/status
```

Attendu : `{"needsSetup":true}`.

- [ ] **Step 6 : commit**

```bash
git add -A
git commit -m "feat(backend): auth multi-comptes portée de ts6-manager"
```

---

### Task 4 : bootstrap du frontend et pages d'authentification

**Files:**
- Create: `packages/frontend/{package.json,index.html,vite.config.ts,tailwind.config.ts,postcss.config.js,components.json,tsconfig.json,vitest.config.ts}`
- Create (copiés) : `src/components/ui/*`, `src/components/shared/{ConfirmDialog,DataTable,EmptyState,LanguageSwitcher,LoadingSpinner,ThemeToggle}.tsx`, `src/components/layout/{AppLayout,Header,Sidebar}.tsx`, `src/api/{client,token-refresh,auth.api}.ts`, `src/stores/{auth.store,ui.store}.ts`, `src/hooks/use-auth.ts`, `src/lib/utils.ts`, `src/styles/globals.css`, `src/i18n/index.ts`, `src/pages/{Login,SetupPage,Settings,NotFound}.tsx`, `scripts/merge-i18n.mjs`
- Create: `src/api/users.api.ts`, `src/i18n/locales/{en,fr}.json`, `src/main.tsx`, `src/App.tsx`, `src/test-setup.ts`
- Test: `src/lib/utils.test.ts`

**Interfaces:**
- Produces: `api` (axios, baseURL `/api`, Bearer + refresh), `useAuthStore` (`accessToken, user, isAdmin()`), `useUiStore` (thème), `AppLayout` avec `Sidebar` contenant la navigation MC, `LANGUAGES = [en, fr]`, pages Login/Setup/Settings/NotFound.

- [ ] **Step 1 : écrire `packages/frontend/package.json`**

Copier `../ts6-manager/packages/frontend/package.json`, nom `@mc/frontend`, et :
- retirer `@xyflow/react`, `flag-icons`, `@radix-ui/react-slider`, `@radix-ui/react-context-menu`, `@radix-ui/react-accordion`, `@radix-ui/react-avatar`, `@radix-ui/react-popover`, `@radix-ui/react-progress`, `@hookform/resolvers`, `react-hook-form` ;
- `@ts6/common` → `@mc/common` ;
- ajouter aux `devDependencies` : `"vitest": "^4.1.8"`, `"@testing-library/react": "^16.3.0"`, `"@testing-library/jest-dom": "^6.9.0"`, `"@testing-library/user-event": "^14.6.1"`, `"jsdom": "^26.1.0"` ;
- scripts : `"test": "vitest run"`, `"i18n:merge": "node scripts/merge-i18n.mjs"`.

- [ ] **Step 2 : copier la configuration et les composants**

```bash
cd /c/Workspace/Minecraft/packages/frontend
S=../../../ts6-manager/packages/frontend
cp $S/{index.html,vite.config.ts,tailwind.config.ts,postcss.config.js,components.json,tsconfig.json} .
mkdir -p src/components/{ui,shared,layout} src/api src/stores src/hooks src/lib src/styles src/i18n/locales src/pages scripts/i18n-fragments
cp $S/src/components/ui/*.tsx src/components/ui/
cp $S/src/components/shared/{ConfirmDialog,DataTable,EmptyState,LanguageSwitcher,LoadingSpinner,ThemeToggle}.tsx src/components/shared/
cp $S/src/components/layout/{AppLayout,Header,Sidebar}.tsx src/components/layout/
cp $S/src/api/{client,token-refresh,auth.api}.ts src/api/
cp $S/src/stores/{auth.store,ui.store}.ts src/stores/
cp $S/src/hooks/use-auth.ts src/hooks/
cp $S/src/lib/utils.ts src/lib/
cp $S/src/styles/globals.css src/styles/
cp $S/src/i18n/index.ts src/i18n/
cp $S/src/pages/{Login,SetupPage,NotFound}.tsx src/pages/
cp $S/scripts/merge-i18n.mjs scripts/
```

Supprimer `src/components/ui/slider.tsx` (dépendance retirée).

- [ ] **Step 3 : adapter les fichiers copiés**

- `index.html` : `lang="fr"`, `<title>MC Manager</title>`, clé localStorage `mc-ui`.
- `tsconfig.json` : `"@ts6/common"` → `"@mc/common": ["../common/src"]`.
- `stores/auth.store.ts` : `name: 'mc-auth'`. `stores/ui.store.ts` : `name: 'mc-ui'`.
- `api/token-refresh.ts` : `PERSIST_KEY = 'mc-auth'`, `LOCK_NAME = 'mc-auth-refresh'`.
- `api/auth.api.ts` : supprimer `samlStatus` et `samlExchange`.
- `i18n/index.ts` : `LANGUAGES = [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }]` (sans `country`), importer seulement `en` et `fr`, clé `mc_lang`.
- `components/shared/LanguageSwitcher.tsx` : remplacer `<Flag code={…} />` par `<span className="text-xs font-semibold uppercase">{l.code}</span>` et supprimer l'import `Flag`.
- `components/layout/Header.tsx` : supprimer `ServerSelector` (import et JSX), mettre à la place `<div />`.
- `components/layout/Sidebar.tsx` : remplacer `navSections` par :

```ts
const navSections = [
  { label: 'nav.server', items: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
    { to: '/console', icon: Terminal, label: 'nav.console' },
  ] },
  { label: 'nav.data', items: [
    { to: '/backups', icon: Archive, label: 'nav.backups' },
    { to: '/audit', icon: History, label: 'nav.audit' },
  ] },
];
```

  avec les icônes `LayoutDashboard, Terminal, Archive, History, Settings, ChevronLeft, ChevronRight` de lucide-react, et le logo `TS` → `MC`, texte `TS6 Manager` → `MC Manager`.
- `pages/Login.tsx` : supprimer `samlEnabled` (état, effet, bloc JSX `{samlEnabled && (...)}`), le bloc "SSO handoff" (de `const mfaState` à l'effet `if (mfaState) navigate(...)`), `ssoLoginUrl`, les imports `useLocation`, `useRef`, `api`.
- `pages/SetupPage.tsx` : rien.
- `main.tsx` : copier et supprimer l'import `flag-icons`.

- [ ] **Step 4 : écrire `src/api/users.api.ts`**

```ts
import api from './client';

export interface UserRow {
  id: number; username: string; displayName: string; role: 'admin' | 'viewer';
  enabled: boolean; createdAt: string; lastLoginAt: string | null; mfaEnabled: boolean; mfaRequired: boolean;
}

export const usersApi = {
  list: (): Promise<UserRow[]> => api.get('/users').then((r) => r.data),
  create: (data: { username: string; password: string; displayName: string; role: string; mfaRequired?: boolean; mustChangePassword?: boolean }) =>
    api.post('/users', data).then((r) => r.data),
  update: (id: number, data: Partial<{ displayName: string; role: string; enabled: boolean; password: string; mfaRequired: boolean; mustChangePassword: boolean; resetMfa: boolean }>) =>
    api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  passwordPolicy: (): Promise<{ minLength: number; requireComplexity: boolean }> => api.get('/users/password-policy').then((r) => r.data),
  updatePasswordPolicy: (data: { minLength: number; requireComplexity: boolean }) => api.put('/users/password-policy', data).then((r) => r.data),
};
```

- [ ] **Step 5 : écrire `src/pages/Settings.tsx`**

Créer le fichier avec, copiées depuis `../ts6-manager/packages/frontend/src/pages/Settings.tsx`, les fonctions `AccountTab` (lignes 104-173), `TrustedDevicesCard` (174-229), `LanguageCard` (230-264), `MfaCard` (265-341), `UsersTab` (481-707) et `PasswordPolicyCard` (1518-1568), avec les imports dont elles ont besoin (`usersApi` depuis `@/api/users.api`). Le composant par défaut :

```tsx
export default function Settings() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account"><Lock className="h-3.5 w-3.5 mr-1" /> {t('settings.tabs.account')}</TabsTrigger>
          {isAdmin && <TabsTrigger value="users"><Users className="h-3.5 w-3.5 mr-1" /> {t('settings.tabs.users')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="account" className="mt-4"><AccountTab /></TabsContent>
        {isAdmin && <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>}
      </Tabs>
    </div>
  );
}
```

Dans `LanguageCard`, remplacer `<Flag …/>` par le code de langue en texte.

- [ ] **Step 6 : écrire `src/App.tsx`**

```tsx
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { useAuthStore } from '@/stores/auth.store';
import { applyUserLanguage } from '@/hooks/use-auth';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } } });

const Login = lazy(() => import('@/pages/Login'));
const SetupPage = lazy(() => import('@/pages/SetupPage'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Console = lazy(() => import('@/pages/Console'));
const Backups = lazy(() => import('@/pages/Backups'));
const Audit = lazy(() => import('@/pages/Audit'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

export function App() {
  useEffect(() => { applyUserLanguage(useAuthStore.getState().user); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/console" element={<Console />} />
              <Route path="/backups" element={<Backups />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

Créer des pages `Dashboard.tsx`, `Console.tsx`, `Backups.tsx`, `Audit.tsx` provisoires contenant `export default function X() { return <h1 className="text-xl font-semibold">X</h1>; }` ; elles sont remplacées dans les tâches 10, 13, 15 et 16.

- [ ] **Step 7 : créer les locales**

Adapter `scripts/merge-i18n.mjs` : `LANGS = ['en', 'fr']`. Créer `src/i18n/locales/en.json` et `fr.json` en extrayant depuis `../ts6-manager/packages/frontend/src/i18n/locales/{en,fr}.json` les espaces de noms `login`, `setup`, `shared`, `nav`, `settings` (sous-clés `title`, `tabs.account`, `tabs.users`, `account`, `users`, `passwordPolicy`, `mfa`, `trusted`, `language`) et `notFound`. Ajouter un fragment `scripts/i18n-fragments/nav.json` :

```json
{ "namespace": "nav", "keys": {
  "en": { "server": "Server", "data": "Data", "dashboard": "Dashboard", "console": "Console", "backups": "Backups", "audit": "Audit log", "settings": "Settings", "logout": "Sign out", "collapse": "Collapse" },
  "fr": { "server": "Serveur", "data": "Données", "dashboard": "Tableau de bord", "console": "Console", "backups": "Sauvegardes", "audit": "Journal d'audit", "settings": "Paramètres", "logout": "Déconnexion", "collapse": "Réduire" }
} }
```

puis `pnpm --filter @mc/frontend run i18n:merge`. Attendu : `OK — N keys across 2 locales`.

- [ ] **Step 8 : configurer vitest pour le frontend**

```ts
// packages/frontend/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src'), '@mc/common': path.resolve(__dirname, '../common/src') } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: true },
});
```

```ts
// packages/frontend/src/test-setup.ts
import '@testing-library/jest-dom/vitest';
```

Ajouter `"types": ["vitest/globals"]` dans `tsconfig.json` et `"src/**/*.test.tsx"`, `"src/**/*.test.ts"` restent inclus par `"include": ["src"]`.

- [ ] **Step 9 : écrire le test de `lib/utils.ts`**

```ts
// src/lib/utils.test.ts
import { formatBytes, formatUptime } from './utils';
describe('formatBytes', () => {
  it('formats gigabytes with one decimal', () => expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB'));
  it('formats zero', () => expect(formatBytes(0)).toBe('0 B'));
});
describe('formatUptime', () => {
  it('renders days hours minutes', () => expect(formatUptime(90061)).toBe('1d 1h 1m'));
});
```

- [ ] **Step 10 : installer, tester, builder**

```bash
pnpm install
pnpm --filter @mc/frontend run test
pnpm --filter @mc/frontend run typecheck
pnpm --filter @mc/frontend run build
pnpm lint
```

Attendu : tests PASS, typecheck et build propres.

- [ ] **Step 11 : vérification manuelle**

`pnpm dev`, ouvrir `http://localhost:5173` : redirection vers `/setup`, création de l'admin, login, arrivée sur le Dashboard provisoire avec la sidebar à quatre entrées, onglets Compte et Utilisateurs fonctionnels, bascule FR/EN.

- [ ] **Step 12 : commit**

```bash
git add -A
git commit -m "feat(frontend): bootstrap React et pages d'authentification portées"
```

---

### Task 5 : types partagés et messages WebSocket

**Files:**
- Create: `packages/common/src/types/{server,metrics,backups,audit}.ts`, `packages/common/src/ws-messages.ts`
- Modify: `packages/common/src/index.ts`

**Interfaces:**
- Produces: tous les types ci-dessous, utilisés par le backend et le frontend.

- [ ] **Step 1 : écrire les types**

```ts
// types/server.ts
export type ServerStatus = 'unavailable' | 'stopped' | 'starting' | 'ready' | 'unhealthy' | 'stopping';

export interface ServerStats {
  cpuPercent: number | null;
  memUsed: number | null;
  memLimit: number | null;
}

export interface ServerInfo {
  status: ServerStatus;
  message?: string;
  containerName: string;
  startedAt: string | null;
  uptimeSeconds: number | null;
  version: string | null;
  players: { online: number; max: number; names: string[] } | null;
  mspt: number | null;
  tps: number | null;
  stats: ServerStats;
  worldBytes: number | null;
  diskFree: number | null;
}
```

```ts
// types/metrics.ts
export type MetricsRange = '24h' | '7d' | '30d';
export interface MetricPoint {
  at: string;
  players: number | null;
  playersMax?: number | null;
  cpuPercent: number | null;
  memUsed: number | null;
  mspt: number | null;
}
export interface MetricsResponse { range: MetricsRange; points: MetricPoint[] }
```

```ts
// types/backups.ts
export interface BackupEntry { name: string; size: number; modifiedAt: string }
export interface BackupList { entries: BackupEntry[]; totalBytes: number; running: boolean }
```

```ts
// types/audit.ts
export type AuditAction =
  | 'server.start' | 'server.stop' | 'server.restart' | 'rcon.command'
  | 'backup.run' | 'backup.delete' | 'backup.download'
  | 'user.create' | 'user.update' | 'user.delete';
export interface AuditEntry { id: number; at: string; userId: number; username: string; action: AuditAction; detail: string | null; ip: string | null }
export interface AuditPage { entries: AuditEntry[]; total: number; page: number; pageSize: number }
```

```ts
// ws-messages.ts
import type { ServerInfo } from './types/server.js';
export interface LogLine { ts: string | null; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'RAW'; thread: string | null; message: string; raw: string }
export type WsMessage =
  | { type: 'server.status'; info: ServerInfo }
  | { type: 'log.line'; line: LogLine }
  | { type: 'log.history'; lines: LogLine[] }
  | { type: 'metrics.tick'; info: ServerInfo }
  | { type: 'backup.progress'; line: string }
  | { type: 'backup.done'; exitCode: number }
  | { type: 'backup.list.changed' };
```

```ts
// index.ts
export * from './types/auth.js';
export * from './types/server.js';
export * from './types/metrics.js';
export * from './types/backups.js';
export * from './types/audit.js';
export * from './ws-messages.js';
```

- [ ] **Step 2 : builder et committer**

```bash
pnpm --filter @mc/common run build && pnpm typecheck
git add -A && git commit -m "feat(common): types partagés serveur, métriques, backups, audit et WebSocket"
```

---

### Task 6 : parseur de `server.properties`

**Files:**
- Create: `packages/backend/src/utils/server-properties.ts`
- Test: `packages/backend/src/utils/server-properties.test.ts`

**Interfaces:**
- Produces: `parseServerProperties(text: string): Record<string, string>`, `readServerProperties(dataDir: string): Promise<Record<string, string>>`, `rconSettings(props): { enabled: boolean; port: number; password: string | null }`.

- [ ] **Step 1 : écrire le test**

```ts
import { describe, it, expect } from 'vitest';
import { parseServerProperties, rconSettings } from './server-properties.js';

const SAMPLE = `#Minecraft server properties
#Fri Oct 10 10:00:00 UTC 2026
enable-rcon=true
rcon.port=25575
rcon.password=s3cret\\=with\\:escapes
motd=A Minecraft Server \\u00e9t\\u00e9
max-players=20
empty=
`;

describe('parseServerProperties', () => {
  it('ignores comments and parses key=value', () => {
    const p = parseServerProperties(SAMPLE);
    expect(p['enable-rcon']).toBe('true');
    expect(p['max-players']).toBe('20');
    expect(p['empty']).toBe('');
  });
  it('unescapes backslash sequences and \\uXXXX', () => {
    const p = parseServerProperties(SAMPLE);
    expect(p['rcon.password']).toBe('s3cret=with:escapes');
    expect(p['motd']).toBe('A Minecraft Server été');
  });
});

describe('rconSettings', () => {
  it('reads enabled, port and password', () => {
    expect(rconSettings(parseServerProperties(SAMPLE))).toEqual({ enabled: true, port: 25575, password: 's3cret=with:escapes' });
  });
  it('defaults when keys are absent', () => {
    expect(rconSettings({})).toEqual({ enabled: false, port: 25575, password: null });
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

```bash
pnpm --filter @mc/backend exec vitest run src/utils/server-properties.test.ts
```

- [ ] **Step 3 : implémenter**

```ts
import { readFile } from 'fs/promises';
import path from 'path';

function unescapeValue(v: string): string {
  return v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

export function parseServerProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const idx = line.search(/(?<!\\)[=:]/);
    if (idx === -1) { out[unescapeValue(line)] = ''; continue; }
    out[unescapeValue(line.slice(0, idx).trim())] = unescapeValue(line.slice(idx + 1).trim());
  }
  return out;
}

export async function readServerProperties(dataDir: string): Promise<Record<string, string>> {
  const text = await readFile(path.join(dataDir, 'server.properties'), 'utf8');
  return parseServerProperties(text);
}

export function rconSettings(props: Record<string, string>): { enabled: boolean; port: number; password: string | null } {
  const port = parseInt(props['rcon.port'] || '25575', 10);
  return {
    enabled: props['enable-rcon'] === 'true',
    port: Number.isInteger(port) ? port : 25575,
    password: props['rcon.password'] ? props['rcon.password'] : null,
  };
}
```

- [ ] **Step 4 : lancer, vérifier le succès, committer**

```bash
pnpm --filter @mc/backend exec vitest run src/utils/server-properties.test.ts
git add -A && git commit -m "feat(backend): parseur de server.properties"
```

---
### Task 7 : DockerService, audit et routes serveur

**Files:**
- Create: `packages/backend/src/docker/docker-like.ts`, `src/docker/fake-docker.ts`, `src/docker/docker-service.ts`, `src/audit/audit.ts`, `src/routes/server.routes.ts`
- Modify: `src/app.ts`, `src/index.ts`
- Test: `src/docker/docker-service.test.ts`, `src/routes/server.routes.test.ts`

**Interfaces:**
- Produces:
  - `interface DockerLike` (sous-ensemble de dockerode utilisé) et `class FakeDocker implements DockerLike` pour les tests.
  - `class DockerService extends EventEmitter` : `start(): Promise<void>` (lance l'écoute des événements), `stop()`, `getStatus(): ServerStatus`, `inspectServer(): Promise<{ status, startedAt, tty, id } | null>`, `startServer()`, `stopServer()`, `restartServer()`, `stats(): Promise<ServerStats>`, `logStream(tail: number): Promise<{ stream: NodeJS.ReadableStream; tty: boolean }>`, `execBackup(cmd: string[]): Promise<{ stream: NodeJS.ReadableStream; wait(): Promise<number> }>`, événement `'status'` `(status: ServerStatus)`.
  - `audit(prisma, req, action: AuditAction, detail?: string): Promise<void>`.
  - Routes `GET /api/server`, `POST /api/server/{start,stop,restart}`.

- [ ] **Step 1 : écrire `docker-like.ts`**

```ts
import type { Readable } from 'stream';

export interface ContainerInspect {
  Id: string;
  Name: string;
  Config: { Tty: boolean; Image: string; Labels?: Record<string, string> };
  State: { Status: string; Running: boolean; StartedAt: string; Health?: { Status: 'starting' | 'healthy' | 'unhealthy' | 'none' } };
}

export interface DockerStatsSample {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
  memory_stats: { usage: number; limit: number; stats?: { cache?: number; inactive_file?: number } };
}

export interface DockerEvent { Type: string; Action: string; Actor: { ID: string; Attributes: Record<string, string> }; time: number }

export interface ContainerLike {
  inspect(): Promise<ContainerInspect>;
  start(): Promise<void>;
  stop(opts: { t: number }): Promise<void>;
  restart(opts: { t: number }): Promise<void>;
  stats(opts: { stream: false }): Promise<DockerStatsSample>;
  logs(opts: { follow: true; stdout: true; stderr: true; tail: number; timestamps: boolean }): Promise<Readable>;
  exec(opts: { Cmd: string[]; AttachStdout: true; AttachStderr: true }): Promise<{ start(opts: object): Promise<Readable>; inspect(): Promise<{ ExitCode: number | null; Running: boolean }> }>;
}

export interface DockerLike {
  /** Résout un conteneur par nom exact ; null s'il n'existe pas. */
  findByName(name: string): Promise<ContainerLike | null>;
  /** Flux d'événements filtré sur les noms donnés. */
  events(names: string[]): Promise<Readable>;
  /** Démultiplexe un flux non-TTY (en-têtes de 8 octets) en stdout/stderr. */
  demux(stream: Readable, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream): void;
}
```

- [ ] **Step 2 : écrire `fake-docker.ts`**

```ts
import { EventEmitter, PassThrough, Readable } from 'stream';
import type { ContainerInspect, ContainerLike, DockerEvent, DockerLike, DockerStatsSample } from './docker-like.js';

export class FakeContainer extends EventEmitter implements ContainerLike {
  calls: string[] = [];
  constructor(public state: ContainerInspect, public statsSample?: DockerStatsSample, public logsStream = new PassThrough(), public execStream = new PassThrough(), public execExit = 0) { super(); }
  async inspect() { return this.state; }
  async start() { this.calls.push('start'); }
  async stop(opts: { t: number }) { this.calls.push(`stop:${opts.t}`); }
  async restart(opts: { t: number }) { this.calls.push(`restart:${opts.t}`); }
  async stats() { if (!this.statsSample) throw new Error('no stats'); return this.statsSample; }
  async logs() { return this.logsStream as unknown as Readable; }
  async exec(opts: { Cmd: string[] }) {
    this.calls.push(`exec:${opts.Cmd.join(' ')}`);
    const self = this;
    return { start: async () => self.execStream as unknown as Readable, inspect: async () => ({ ExitCode: self.execExit, Running: false }) };
  }
}

export class FakeDocker implements DockerLike {
  containers = new Map<string, FakeContainer>();
  eventStream = new PassThrough();
  async findByName(name: string) { return this.containers.get(name) ?? null; }
  async events() { return this.eventStream as unknown as Readable; }
  demux(stream: Readable, stdout: NodeJS.WritableStream) { stream.pipe(stdout); }
  emitEvent(ev: Partial<DockerEvent> & { Action: string; name: string }) {
    this.eventStream.write(JSON.stringify({ Type: 'container', Action: ev.Action, Actor: { ID: 'x', Attributes: { name: ev.name } }, time: Date.now() / 1000 }) + '\n');
  }
}

export function inspectFixture(over: Partial<ContainerInspect['State']> & { Tty?: boolean } = {}): ContainerInspect {
  const { Tty = false, ...state } = over;
  return {
    Id: 'abc', Name: '/mc', Config: { Tty, Image: 'itzg/minecraft-server:latest' },
    State: { Status: 'running', Running: true, StartedAt: '2026-10-10T10:00:00Z', Health: { Status: 'healthy' }, ...state },
  };
}
```

- [ ] **Step 3 : écrire le test de `DockerService`**

```ts
import { describe, it, expect } from 'vitest';
import { DockerService, statusFromInspect, cpuPercentFrom } from './docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from './fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('statusFromInspect', () => {
  it('maps null to unavailable', () => expect(statusFromInspect(null)).toBe('unavailable'));
  it('maps exited to stopped', () => expect(statusFromInspect(inspectFixture({ Status: 'exited', Running: false }))).toBe('stopped'));
  it('maps running+starting to starting', () => expect(statusFromInspect(inspectFixture({ Health: { Status: 'starting' } }))).toBe('starting'));
  it('maps running+healthy to ready', () => expect(statusFromInspect(inspectFixture())).toBe('ready'));
  it('maps running+unhealthy to unhealthy', () => expect(statusFromInspect(inspectFixture({ Health: { Status: 'unhealthy' } }))).toBe('unhealthy'));
  it('maps running without healthcheck to ready', () => expect(statusFromInspect(inspectFixture({ Health: undefined }))).toBe('ready'));
});

describe('cpuPercentFrom', () => {
  it('computes percent from deltas and online cpus', () => {
    const pct = cpuPercentFrom({
      cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 10_000, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 8_000 },
      memory_stats: { usage: 0, limit: 0 },
    });
    expect(pct).toBeCloseTo(200);
  });
});

describe('DockerService', () => {
  it('resolves the container by name on every call so a recreated container is found', async () => {
    const docker = new FakeDocker();
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    expect(await svc.inspectServer()).toBeNull();
    docker.containers.set('mc', new FakeContainer(inspectFixture()));
    expect((await svc.inspectServer())?.status).toBe('ready');
    docker.containers.set('mc', new FakeContainer({ ...inspectFixture(), Id: 'new-id' }));
    expect((await svc.inspectServer())?.id).toBe('new-id');
  });

  it('emits status on docker events', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture({ Status: 'exited', Running: false }));
    docker.containers.set('mc', c);
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    const seen: string[] = [];
    svc.on('status', (s) => seen.push(s));
    await svc.start();
    expect(svc.getStatus()).toBe('stopped');
    c.state = inspectFixture({ Health: { Status: 'starting' } });
    docker.emitEvent({ Action: 'start', name: 'mc' });
    await wait(10);
    c.state = inspectFixture();
    docker.emitEvent({ Action: 'health_status: healthy', name: 'mc' });
    await wait(10);
    expect(seen).toEqual(['starting', 'ready']);
    svc.stop();
  });

  it('ignores events from other containers', async () => {
    const docker = new FakeDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture()));
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    const seen: string[] = [];
    svc.on('status', (s) => seen.push(s));
    await svc.start();
    docker.emitEvent({ Action: 'die', name: 'other' });
    await wait(10);
    expect(seen).toEqual([]);
    svc.stop();
  });

  it('stopServer uses a 60 s grace period and sets stopping', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture());
    docker.containers.set('mc', c);
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    const p = svc.stopServer();
    expect(svc.getStatus()).toBe('stopping');
    await p;
    expect(c.calls).toEqual(['stop:60']);
    svc.stop();
  });

  it('throws a 503 AppError when the container is missing', async () => {
    const svc = new DockerService(new FakeDocker(), 'mc', 'mc-backup');
    await expect(svc.startServer()).rejects.toMatchObject({ statusCode: 503 });
  });
});
```

- [ ] **Step 4 : lancer, vérifier l'échec**

```bash
pnpm --filter @mc/backend exec vitest run src/docker/docker-service.test.ts
```

- [ ] **Step 5 : implémenter `docker-service.ts`**

```ts
import { EventEmitter } from 'events';
import Docker from 'dockerode';
import type { Readable } from 'stream';
import type { ServerStatus, ServerStats } from '@mc/common';
import type { ContainerInspect, ContainerLike, DockerLike, DockerStatsSample } from './docker-like.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export function statusFromInspect(i: ContainerInspect | null): ServerStatus {
  if (!i) return 'unavailable';
  if (!i.State.Running) return 'stopped';
  const h = i.State.Health?.Status;
  if (h === 'starting') return 'starting';
  if (h === 'unhealthy') return 'unhealthy';
  return 'ready';
}

export function cpuPercentFrom(s: DockerStatsSample): number | null {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
  if (!(sysDelta > 0) || cpuDelta < 0) return null;
  return (cpuDelta / sysDelta) * (s.cpu_stats.online_cpus || 1) * 100;
}

/** Adaptateur dockerode → DockerLike. */
export function realDocker(socketPath: string): DockerLike {
  const docker = new Docker({ socketPath });
  return {
    async findByName(name) {
      const list = await docker.listContainers({ all: true, filters: { name: [name] } });
      const hit = list.find((c) => c.Names.includes(`/${name}`));
      return hit ? (docker.getContainer(hit.Id) as unknown as ContainerLike) : null;
    },
    async events(names) {
      return docker.getEvents({ filters: { type: ['container'], container: names } }) as unknown as Readable;
    },
    demux(stream, stdout, stderr) { docker.modem.demuxStream(stream, stdout, stderr); },
  };
}

export class DockerService extends EventEmitter {
  private status: ServerStatus = 'unavailable';
  private eventStream: Readable | null = null;
  private stopped = false;
  private retryMs = 1000;

  constructor(private docker: DockerLike, private serverName: string, private backupName: string) { super(); }

  getStatus(): ServerStatus { return this.status; }

  async inspectServer(): Promise<{ status: ServerStatus; startedAt: string | null; tty: boolean; id: string; image: string } | null> {
    const c = await this.docker.findByName(this.serverName);
    if (!c) return null;
    const i = await c.inspect();
    return { status: statusFromInspect(i), startedAt: i.State.Running ? i.State.StartedAt : null, tty: i.Config.Tty, id: i.Id, image: i.Config.Image };
  }

  private setStatus(s: ServerStatus) {
    if (s === this.status) return;
    this.status = s;
    this.emit('status', s);
  }

  async refresh(): Promise<ServerStatus> {
    try {
      const i = await this.inspectServer();
      this.setStatus(i ? i.status : 'unavailable');
    } catch (err) {
      logger.warn({ err }, 'docker inspect failed');
      this.setStatus('unavailable');
    }
    return this.status;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.refresh();
    void this.listen();
  }

  stop(): void {
    this.stopped = true;
    this.eventStream?.destroy();
    this.eventStream = null;
  }

  private async listen(): Promise<void> {
    while (!this.stopped) {
      try {
        const stream = await this.docker.events([this.serverName, this.backupName]);
        this.eventStream = stream;
        this.retryMs = 1000;
        let buf = '';
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
              if (!line) continue;
              try {
                const ev = JSON.parse(line) as { Action: string; Actor: { Attributes: Record<string, string> } };
                if (ev.Actor?.Attributes?.name !== this.serverName) continue;
                if (/^(start|die|stop|kill|destroy|health_status)/.test(ev.Action)) void this.refresh();
              } catch { /* ligne non JSON, ignorée */ }
            }
          });
          stream.once('end', resolve);
          stream.once('close', resolve);
          stream.once('error', reject);
        });
      } catch (err) {
        if (!this.stopped) logger.warn({ err }, 'docker events stream failed');
      }
      if (this.stopped) return;
      this.setStatus('unavailable');
      await new Promise((r) => setTimeout(r, this.retryMs));
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    }
  }

  private async requireServer(): Promise<ContainerLike> {
    const c = await this.docker.findByName(this.serverName);
    if (!c) throw new AppError(503, `Container "${this.serverName}" not found`);
    return c;
  }

  async startServer(): Promise<void> { const c = await this.requireServer(); await c.start(); void this.refresh(); }
  async stopServer(): Promise<void> { const c = await this.requireServer(); this.setStatus('stopping'); await c.stop({ t: 60 }); void this.refresh(); }
  async restartServer(): Promise<void> { const c = await this.requireServer(); this.setStatus('stopping'); await c.restart({ t: 60 }); void this.refresh(); }

  async stats(): Promise<ServerStats> {
    const c = await this.docker.findByName(this.serverName);
    if (!c) return { cpuPercent: null, memUsed: null, memLimit: null };
    try {
      const s = await c.stats({ stream: false });
      const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0;
      return { cpuPercent: cpuPercentFrom(s), memUsed: s.memory_stats.usage - cache, memLimit: s.memory_stats.limit };
    } catch { return { cpuPercent: null, memUsed: null, memLimit: null }; }
  }

  async logStream(tail: number): Promise<{ stream: Readable; tty: boolean }> {
    const c = await this.requireServer();
    const i = await c.inspect();
    const stream = await c.logs({ follow: true, stdout: true, stderr: true, tail, timestamps: false });
    return { stream, tty: i.Config.Tty };
  }

  demux(stream: Readable, out: NodeJS.WritableStream): void { this.docker.demux(stream, out, out); }

  async execBackup(cmd: string[]): Promise<{ stream: Readable; wait(): Promise<number> }> {
    const c = await this.docker.findByName(this.backupName);
    if (!c) throw new AppError(503, `Container "${this.backupName}" not found`);
    const exec = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({});
    return {
      stream,
      wait: async () => {
        await new Promise<void>((resolve) => { stream.once('end', resolve); stream.once('close', resolve); });
        const info = await exec.inspect();
        return info.ExitCode ?? 1;
      },
    };
  }
}
```

- [ ] **Step 6 : lancer, vérifier le succès**

```bash
pnpm --filter @mc/backend exec vitest run src/docker/docker-service.test.ts
```

- [ ] **Step 7 : écrire `src/audit/audit.ts`**

```ts
import type { Request } from 'express';
import type { AuditAction } from '@mc/common';
import { logger } from '../utils/logger.js';

export async function audit(req: Request, action: AuditAction, detail?: string): Promise<void> {
  const prisma = req.app.locals.prisma;
  const u = req.user;
  if (!u) return;
  try {
    await prisma.auditLog.create({ data: { userId: u.id, username: u.username, action, detail: detail ?? null, ip: req.ip ?? null } });
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}
```

- [ ] **Step 8 : écrire le test des routes serveur**

```ts
// src/routes/server.routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverRoutes } from './server.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

function appWith(role: 'admin' | 'viewer', docker: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.docker = docker;
  app.locals.serverInfo = async () => ({ status: docker.getStatus(), containerName: 'mc' });
  app.use('/api/server', serverRoutes);
  app.use(errorHandler);
  return app;
}

describe('server routes', () => {
  let docker: Record<string, unknown>;
  beforeEach(() => {
    docker = { getStatus: () => 'ready', startServer: vi.fn().mockResolvedValue(undefined), stopServer: vi.fn().mockResolvedValue(undefined), restartServer: vi.fn().mockResolvedValue(undefined) };
  });
  it('GET returns the server info', async () => {
    const res = await request(appWith('viewer', docker)).get('/api/server');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
  it('viewer cannot start', async () => {
    const res = await request(appWith('viewer', docker)).post('/api/server/start');
    expect(res.status).toBe(403);
    expect(docker.startServer).not.toHaveBeenCalled();
  });
  it('admin start returns 202 and writes an audit row', async () => {
    const app = appWith('admin', docker);
    const res = await request(app).post('/api/server/start');
    expect(res.status).toBe(202);
    expect(docker.startServer).toHaveBeenCalledOnce();
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'server.start' }) }));
  });
});
```

Ajouter `"supertest": "^7.1.4"` et `"@types/supertest": "^6.0.3"` aux devDependencies du backend puis `pnpm install`.

- [ ] **Step 9 : implémenter `server.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import type { ServerInfo } from '@mc/common';

export const serverRoutes: Router = Router();

serverRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info: ServerInfo = await req.app.locals.serverInfo();
    res.json(info);
  } catch (err) { next(err); }
});

for (const [action, method] of [['start', 'startServer'], ['stop', 'stopServer'], ['restart', 'restartServer']] as const) {
  serverRoutes.post(`/${action}`, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await req.app.locals.docker[method]();
      await audit(req, `server.${action}`);
      res.status(202).json({ accepted: true });
    } catch (err) { next(err); }
  });
}
```

- [ ] **Step 10 : brancher dans `index.ts` et `app.ts`**

Dans `app.ts`, après `app.use('/api/users', userRoutes)` : `app.use('/api/server', serverRoutes);`.

Dans `index.ts` :

```ts
import { DockerService, realDocker } from './docker/docker-service.js';
import { readServerProperties } from './utils/server-properties.js';
// ...
const docker = new DockerService(realDocker(config.mc.dockerSocket), config.mc.container, config.mc.backupContainer);
app.locals.docker = docker;
await docker.start();

// Construit la réponse de GET /api/server. Les tâches 11 et 12 enrichissent
// players/mspt/tps/worldBytes/diskFree via app.locals.metrics.
app.locals.serverInfo = async (): Promise<ServerInfo> => {
  const i = await docker.inspectServer().catch(() => null);
  const stats = await docker.stats();
  const startedAt = i?.startedAt ?? null;
  const latest = app.locals.metrics?.latest?.() ?? {};
  return {
    status: i ? i.status : 'unavailable',
    message: i ? undefined : `Container "${config.mc.container}" not found or Docker socket unreachable`,
    containerName: config.mc.container,
    startedAt,
    uptimeSeconds: startedAt ? Math.floor((Date.now() - Date.parse(startedAt)) / 1000) : null,
    version: latest.version ?? null,
    players: latest.players ?? null,
    mspt: latest.mspt ?? null,
    tps: latest.tps ?? null,
    stats,
    worldBytes: latest.worldBytes ?? null,
    diskFree: latest.diskFree ?? null,
  };
};
```

et dans `shutdown` : `docker.stop();`.

- [ ] **Step 11 : vérifier et committer**

```bash
pnpm --filter @mc/backend run typecheck && pnpm --filter @mc/backend run test
git add -A && git commit -m "feat(backend): DockerService, audit et routes de contrôle du serveur"
```

---

### Task 8 : WebSocket (serveur et client)

**Files:**
- Create: `packages/backend/src/ws/ws-server.ts`, `src/ws/ws-broadcast.ts`
- Create: `packages/frontend/src/stores/server.store.ts`, `src/hooks/use-websocket.ts`, `src/api/server.api.ts`
- Modify: `packages/backend/src/index.ts`, `packages/frontend/src/components/layout/AppLayout.tsx`
- Test: `packages/backend/src/ws/ws-broadcast.test.ts`, `packages/frontend/src/stores/server.store.test.ts`, `packages/frontend/src/hooks/use-websocket.test.ts`

**Interfaces:**
- Produces: `broadcast(wss, msg: WsMessage)`, `attachWebSocket(server, prisma): WebSocketServer`, `useServerStore` (`info, logs, backupOutput, backupRunning, apply(msg)`), `useWebSocket()` monté dans `AppLayout`, `serverApi.get()`, `serverApi.start/stop/restart()`.

- [ ] **Step 1 : test de `ws-broadcast.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { broadcast } from './ws-broadcast.js';

describe('broadcast', () => {
  it('sends the JSON message to every open socket only', () => {
    const open = { readyState: 1, authed: true, send: vi.fn() };
    const pending = { readyState: 1, send: vi.fn() };
    const closed = { readyState: 3, authed: true, send: vi.fn() };
    broadcast({ clients: new Set([open, pending, closed]) } as never, { type: 'backup.list.changed' });
    expect(open.send).toHaveBeenCalledWith('{"type":"backup.list.changed"}');
    expect(pending.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : implémenter `ws-broadcast.ts` et `ws-server.ts`**

```ts
// ws-broadcast.ts
import type { WebSocketServer } from 'ws';
import type { WsMessage } from '@mc/common';
type AuthedSocket = { readyState: number; authed?: boolean; send(data: string): void };
export function markAuthenticated(socket: unknown): void { (socket as AuthedSocket).authed = true; }
export function broadcast(wss: WebSocketServer, msg: WsMessage): void {
  const data = JSON.stringify(msg);
  wss.clients.forEach((raw) => { const c = raw as unknown as AuthedSocket; if (c.readyState === 1 && c.authed) c.send(data); });
}
```

```ts
// ws-server.ts
import type { Server } from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@mc/common';
import { config } from '../config.js';

import type { IncomingMessage } from 'http';

type PrismaLike = { user: { findUnique(args: { where: { id: number }; select: { enabled: true } }): Promise<{ enabled: boolean } | null> } };

/** Identité portée par le token de la query string, ou null si invalide. */
export async function authenticate(req: IncomingMessage, prisma: PrismaLike): Promise<JwtPayload | null> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');
    if (!token) return null;
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
    if (payload.typ !== 'access') return null;
    const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { enabled: true } });
    return user?.enabled ? payload : null;
  } catch { return null; }
}

/**
 * La connexion est acceptée puis fermée en 4401 si le token est invalide :
 * un refus au handshake arrive au navigateur comme un 1006 indistinct, alors
 * que le code 4401 permet au client de rafraîchir son token avant de réessayer.
 * Le handler 'connection' ne reçoit que des sockets authentifiés : il attend
 * l'événement 'authenticated' émis ici.
 */
export function attachWebSocket(server: Server, prisma: PrismaLike): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket, req) => {
    void authenticate(req, prisma).then((identity) => {
      if (!identity) { socket.close(4401, 'Unauthenticated'); return; }
      wss.emit('authenticated', socket, identity);
    });
  });
  return wss;
}
```

Dans `index.ts`, écouter `wss.on('authenticated', (socket) => …)` plutôt que `'connection'` pour l'envoi de `server.status` et `log.history`. `broadcast` ignore les sockets non authentifiés car ils sont fermés avant tout envoi utile ; pour fermer la fenêtre entre acceptation et vérification, `broadcast` ne cible que les sockets marqués : dans le handler `'authenticated'`, faire `(socket as { authed?: boolean }).authed = true`, et dans `ws-broadcast.ts` filtrer `if (c.readyState === 1 && (c as { authed?: boolean }).authed)`. Mettre à jour le test de `broadcast` en conséquence (`open = { readyState: 1, authed: true, send }`).

Test de `authenticate` (`ws-server.test.ts`) :

```ts
import { it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticate } from './ws-server.js';
import { config } from '../config.js';
const prisma = { user: { findUnique: async () => ({ enabled: true }) } };
it('accepts an access token', async () => {
  const tok = jwt.sign({ typ: 'access', id: 1, username: 'u', role: 'admin' }, config.jwtSecret);
  expect(await authenticate({ url: `/ws?token=${tok}`, headers: { host: 'x' } } as never, prisma)).toMatchObject({ id: 1 });
});
it('rejects an mfa token and a missing token', async () => {
  const tok = jwt.sign({ typ: 'mfa', id: 1 }, config.jwtSecret);
  expect(await authenticate({ url: `/ws?token=${tok}`, headers: { host: 'x' } } as never, prisma)).toBeNull();
  expect(await authenticate({ url: '/ws', headers: { host: 'x' } } as never, prisma)).toBeNull();
});
```

Dans `index.ts` : `const wss = attachWebSocket(server, prisma); app.locals.wss = wss;` avant `docker.start()`, puis `docker.on('status', () => { void app.locals.serverInfo().then((info) => broadcast(wss, { type: 'server.status', info })); });` et `wss.on('authenticated', (socket) => { markAuthenticated(socket); void app.locals.serverInfo().then((info) => socket.send(JSON.stringify({ type: 'server.status', info }))); });`. Dans `shutdown` : `wss.close()`.

- [ ] **Step 3 : lancer le test backend**

```bash
pnpm --filter @mc/backend exec vitest run src/ws
```

- [ ] **Step 4 : test du store frontend**

```ts
// src/stores/server.store.test.ts
import { useServerStore, LOG_CAP } from './server.store';
const line = (i: number) => ({ ts: null, level: 'INFO' as const, thread: null, message: `m${i}`, raw: `m${i}` });

describe('serverStore', () => {
  beforeEach(() => useServerStore.getState().reset());
  it('applies server.status', () => {
    useServerStore.getState().apply({ type: 'server.status', info: { status: 'ready' } as never });
    expect(useServerStore.getState().info?.status).toBe('ready');
  });
  it('replaces logs on log.history and appends on log.line', () => {
    useServerStore.getState().apply({ type: 'log.history', lines: [line(1), line(2)] });
    useServerStore.getState().apply({ type: 'log.line', line: line(3) });
    expect(useServerStore.getState().logs.map((l) => l.message)).toEqual(['m1', 'm2', 'm3']);
  });
  it('caps the log buffer', () => {
    for (let i = 0; i < LOG_CAP + 10; i++) useServerStore.getState().apply({ type: 'log.line', line: line(i) });
    const logs = useServerStore.getState().logs;
    expect(logs).toHaveLength(LOG_CAP);
    expect(logs[0].message).toBe('m10');
  });
  it('tracks backup output and running flag', () => {
    useServerStore.getState().startBackupOutput();
    useServerStore.getState().apply({ type: 'backup.progress', line: 'a' });
    expect(useServerStore.getState().backupRunning).toBe(true);
    useServerStore.getState().apply({ type: 'backup.done', exitCode: 0 });
    expect(useServerStore.getState().backupRunning).toBe(false);
    expect(useServerStore.getState().backupOutput).toEqual(['a']);
  });
});
```

- [ ] **Step 5 : implémenter `server.store.ts`**

```ts
import { create } from 'zustand';
import type { LogLine, ServerInfo, WsMessage } from '@mc/common';

export const LOG_CAP = 2000;

interface ServerStore {
  info: ServerInfo | null;
  logs: LogLine[];
  backupOutput: string[];
  backupRunning: boolean;
  connected: boolean;
  setConnected: (v: boolean) => void;
  startBackupOutput: () => void;
  apply: (msg: WsMessage) => void;
  reset: () => void;
}

export const useServerStore = create<ServerStore>()((set) => ({
  info: null, logs: [], backupOutput: [], backupRunning: false, connected: false,
  setConnected: (connected) => set({ connected }),
  startBackupOutput: () => set({ backupOutput: [], backupRunning: true }),
  reset: () => set({ info: null, logs: [], backupOutput: [], backupRunning: false }),
  apply: (msg) => set((s) => {
    switch (msg.type) {
      case 'server.status':
      case 'metrics.tick': return { info: msg.info };
      case 'log.history': return { logs: msg.lines.slice(-LOG_CAP) };
      case 'log.line': { const logs = s.logs.length >= LOG_CAP ? s.logs.slice(s.logs.length - LOG_CAP + 1) : s.logs; return { logs: [...logs, msg.line] }; }
      case 'backup.progress': return { backupOutput: [...s.backupOutput, msg.line], backupRunning: true };
      case 'backup.done': return { backupRunning: false };
      default: return {};
    }
  }),
}));
```

- [ ] **Step 6 : test du hook `useWebSocket`**

```ts
// src/hooks/use-websocket.test.ts
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useWebSocket } from './use-websocket';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null; onclose: ((e: { code: number }) => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  close() {}
}

vi.mock('@/api/token-refresh', () => ({ refreshAccessToken: vi.fn().mockResolvedValue('fresh-token') }));
import { refreshAccessToken } from '@/api/token-refresh';

describe('useWebSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
    useAuthStore.setState({ accessToken: 'tok', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);

  it('connects with the access token and applies messages', () => {
    renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    expect(ws.url).toContain('token=tok');
    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'server.status', info: { status: 'ready' } }) }));
    expect(useServerStore.getState().info?.status).toBe('ready');
  });

  it('refreshes the token before reconnecting after a 4401 close', async () => {
    renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    await act(async () => { ws.onclose?.({ code: 4401 }); await vi.advanceTimersByTimeAsync(1500); });
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(FakeSocket.instances[1].url).toContain('token=fresh-token');
  });
});
```

- [ ] **Step 7 : implémenter `use-websocket.ts`**

```ts
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsMessage } from '@mc/common';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { refreshAccessToken } from '@/api/token-refresh';

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

export function useWebSocket(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const apply = useServerStore((s) => s.apply);
  const setConnected = useServerStore((s) => s.setConnected);
  const retryRef = useRef(1000);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!accessToken) return;
    stoppedRef.current = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = (token: string) => {
      socket = new WebSocket(wsUrl(token));
      socket.onopen = () => {
        retryRef.current = 1000;
        setConnected(true);
        void queryClient.invalidateQueries({ queryKey: ['server'] });
        void queryClient.invalidateQueries({ queryKey: ['backups'] });
        void queryClient.invalidateQueries({ queryKey: ['metrics'] });
      };
      socket.onmessage = (e) => { try { apply(JSON.parse(e.data) as WsMessage); } catch { /* message illisible, ignoré */ } };
      socket.onclose = (e) => {
        setConnected(false);
        if (stoppedRef.current) return;
        const delay = retryRef.current;
        retryRef.current = Math.min(delay * 2, 30_000);
        timer = setTimeout(async () => {
          if (stoppedRef.current) return;
          let next: string | null = useAuthStore.getState().accessToken;
          if (e.code === 4401 || e.code === 1008) next = await refreshAccessToken();
          if (next) connect(next);
        }, delay);
      };
    };
    connect(accessToken);

    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
    // accessToken change = nouvelle session ; les refresh passent par refreshAccessToken dans onclose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken ? 'has-token' : 'no-token']);
}
```

Monter dans `AppLayout` : `useWebSocket();` juste après `useQuery(['me'])`.

- [ ] **Step 8 : écrire `src/api/server.api.ts`**

```ts
import api from './client';
import type { ServerInfo } from '@mc/common';
export const serverApi = {
  get: (): Promise<ServerInfo> => api.get('/server').then((r) => r.data),
  start: () => api.post('/server/start'),
  stop: () => api.post('/server/stop'),
  restart: () => api.post('/server/restart'),
  command: (command: string): Promise<{ response: string }> => api.post('/server/command', { command }).then((r) => r.data),
};
```

- [ ] **Step 9 : tests, typecheck, commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A && git commit -m "feat: WebSocket authentifié, store serveur et reconnexion côté client"
```

---

### Task 9 : parseur de logs et LogStreamer

**Files:**
- Create: `packages/backend/src/logs/parse-line.ts`, `src/logs/log-streamer.ts`
- Modify: `src/index.ts`
- Test: `src/logs/parse-line.test.ts`, `src/logs/log-streamer.test.ts`

**Interfaces:**
- Produces: `parseLogLine(raw: string): LogLine`, `class LogStreamer` : `start()`, `stop()`, `history(): LogLine[]`, événement `'line'` `(line: LogLine)`.

- [ ] **Step 1 : test de `parseLogLine`**

```ts
import { describe, it, expect } from 'vitest';
import { parseLogLine } from './parse-line.js';

describe('parseLogLine', () => {
  it('parses the vanilla format', () => {
    expect(parseLogLine('[12:34:56] [Server thread/INFO]: Done (3.2s)! For help, type "help"')).toEqual({
      ts: '12:34:56', level: 'INFO', thread: 'Server thread', message: 'Done (3.2s)! For help, type "help"', raw: '[12:34:56] [Server thread/INFO]: Done (3.2s)! For help, type "help"',
    });
  });
  it('parses WARN with a slash in the thread name', () => {
    expect(parseLogLine('[12:00:00] [Worker-Main-3/WARN]: x').level).toBe('WARN');
  });
  it('falls back to RAW for itzg startup lines', () => {
    expect(parseLogLine('[init] Starting the Minecraft server...')).toMatchObject({ level: 'RAW', ts: null, message: '[init] Starting the Minecraft server...' });
  });
  it('strips a trailing carriage return', () => {
    expect(parseLogLine('[12:00:00] [main/INFO]: hi\r').message).toBe('hi');
  });
});
```

- [ ] **Step 2 : implémenter `parse-line.ts`**

```ts
import type { LogLine } from '@mc/common';
const RE = /^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]*?)\/(INFO|WARN|ERROR|DEBUG|FATAL|TRACE)\]: ?(.*)$/;
export function parseLogLine(rawIn: string): LogLine {
  const raw = rawIn.replace(/\r$/, '');
  const m = RE.exec(raw);
  if (!m) return { ts: null, level: 'RAW', thread: null, message: raw, raw };
  const level = m[3] === 'FATAL' ? 'ERROR' : m[3] === 'TRACE' ? 'DEBUG' : (m[3] as LogLine['level']);
  return { ts: m[1], level, thread: m[2], message: m[4], raw };
}
```

- [ ] **Step 3 : test de `LogStreamer`**

```ts
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import { LogStreamer } from './log-streamer.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(tty: boolean) {
  const docker = new FakeDocker();
  const logs = new PassThrough();
  const c = new FakeContainer(inspectFixture({ Tty: tty }), undefined, logs);
  docker.containers.set('mc', c);
  const svc = new DockerService(docker, 'mc', 'mc-backup');
  return { docker, logs, svc, streamer: new LogStreamer(svc, 3) };
}

describe('LogStreamer', () => {
  it('emits parsed lines and keeps a bounded history', async () => {
    const { logs, streamer } = setup(true);
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    await streamer.start();
    logs.write('[10:00:00] [main/INFO]: one\n[10:00:01] [main/INFO]: two\n');
    logs.write('[10:00:02] [main/INFO]: thr');
    logs.write('ee\n[10:00:03] [main/INFO]: four\n');
    await wait(10);
    expect(seen).toEqual(['one', 'two', 'three', 'four']);
    expect(streamer.history().map((l) => l.message)).toEqual(['two', 'three', 'four']);
    streamer.stop();
  });

  it('demultiplexes a non-tty stream through DockerLike.demux', async () => {
    const { logs, streamer, docker } = setup(false);
    let demuxed = false;
    docker.demux = (stream, out) => { demuxed = true; stream.pipe(out); };
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    await streamer.start();
    logs.write('[10:00:00] [main/INFO]: x\n');
    await wait(10);
    expect(demuxed).toBe(true);
    expect(seen).toEqual(['x']);
    streamer.stop();
  });

  it('reopens the stream on a start event', async () => {
    const { streamer, svc, docker } = setup(true);
    await streamer.start();
    const fresh = new PassThrough();
    docker.containers.set('mc', new FakeContainer(inspectFixture({ Tty: true }), undefined, fresh));
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    svc.emit('status', 'starting');
    await wait(10);
    fresh.write('[10:00:00] [main/INFO]: after\n');
    await wait(10);
    expect(seen).toEqual(['after']);
    streamer.stop();
  });
});
```

- [ ] **Step 4 : implémenter `log-streamer.ts`**

```ts
import { EventEmitter } from 'events';
import { PassThrough, type Readable } from 'stream';
import type { LogLine, ServerStatus } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import { parseLogLine } from './parse-line.js';
import { logger } from '../utils/logger.js';

export class LogStreamer extends EventEmitter {
  private buffer: LogLine[] = [];
  private current: Readable | null = null;
  private stopped = false;
  private onStatus = (s: ServerStatus) => { if (s === 'starting' || s === 'ready') void this.open(); };

  constructor(private docker: DockerService, private cap = 500) { super(); }

  history(): LogLine[] { return [...this.buffer]; }

  async start(): Promise<void> {
    this.stopped = false;
    this.docker.on('status', this.onStatus);
    await this.open();
  }

  stop(): void {
    this.stopped = true;
    this.docker.off('status', this.onStatus);
    this.current?.destroy();
    this.current = null;
  }

  private async open(): Promise<void> {
    this.current?.destroy();
    this.current = null;
    if (this.stopped) return;
    let handle: { stream: Readable; tty: boolean };
    try { handle = await this.docker.logStream(this.cap); }
    catch (err) { logger.warn({ err }, 'log stream unavailable'); return; }
    this.current = handle.stream;
    const text = new PassThrough();
    if (handle.tty) handle.stream.pipe(text); else this.docker.demux(handle.stream, text);
    let partial = '';
    text.on('data', (chunk: Buffer) => {
      partial += chunk.toString('utf8');
      let nl: number;
      while ((nl = partial.indexOf('\n')) >= 0) {
        const line = parseLogLine(partial.slice(0, nl));
        partial = partial.slice(nl + 1);
        this.buffer.push(line);
        if (this.buffer.length > this.cap) this.buffer.shift();
        this.emit('line', line);
      }
    });
    handle.stream.once('error', (err) => logger.warn({ err }, 'log stream error'));
  }
}
```

- [ ] **Step 5 : lancer les tests**

```bash
pnpm --filter @mc/backend exec vitest run src/logs
```

- [ ] **Step 6 : brancher dans `index.ts`**

```ts
import { LogStreamer } from './logs/log-streamer.js';
// après docker.start()
const logs = new LogStreamer(docker, 500);
app.locals.logs = logs;
logs.on('line', (line) => broadcast(wss, { type: 'log.line', line }));
await logs.start();
// dans wss.on('authenticated') : socket.send(JSON.stringify({ type: 'log.history', lines: logs.history() }));
// dans shutdown : logs.stop();
```

- [ ] **Step 7 : commit**

```bash
pnpm --filter @mc/backend run typecheck && pnpm --filter @mc/backend run test
git add -A && git commit -m "feat(backend): flux de logs Docker parsé et diffusé en WebSocket"
```

---
### Task 10 : pages Dashboard (bandeau d'état) et Console (logs)

**Files:**
- Create: `packages/frontend/src/lib/format.ts`, `src/components/dashboard/StatusBanner.tsx`, `src/components/console/LogView.tsx`
- Modify: `src/pages/Dashboard.tsx`, `src/pages/Console.tsx`, locales via fragment `scripts/i18n-fragments/server.json`
- Test: `src/lib/format.test.ts`, `src/components/console/LogView.test.tsx`

**Interfaces:**
- Consumes: `useServerStore`, `serverApi`, `ConfirmDialog`.
- Produces: `StatusBanner`, `LogView({ lines, paused, filter, level })`, `formatMspt`, `formatPercent`, `statusTone(status)`.

- [ ] **Step 1 : test de `format.ts`**

```ts
import { formatMspt, formatPercent, statusTone } from './format';
describe('format', () => {
  it('formatMspt renders one decimal and null as dash', () => { expect(formatMspt(3.456)).toBe('3.5 ms'); expect(formatMspt(null)).toBe('—'); });
  it('formatPercent rounds', () => { expect(formatPercent(12.34)).toBe('12 %'); expect(formatPercent(null)).toBe('—'); });
  it('statusTone maps statuses', () => {
    expect(statusTone('ready')).toBe('ok'); expect(statusTone('starting')).toBe('warn'); expect(statusTone('stopping')).toBe('warn');
    expect(statusTone('unhealthy')).toBe('error'); expect(statusTone('unavailable')).toBe('error'); expect(statusTone('stopped')).toBe('muted');
  });
});
```

- [ ] **Step 2 : implémenter `format.ts`**

```ts
import type { ServerStatus } from '@mc/common';
export const formatMspt = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} ms`);
export const formatPercent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} %`);
export type Tone = 'ok' | 'warn' | 'error' | 'muted';
export function statusTone(s: ServerStatus): Tone {
  switch (s) { case 'ready': return 'ok'; case 'starting': case 'stopping': return 'warn'; case 'unhealthy': case 'unavailable': return 'error'; default: return 'muted'; }
}
export const toneClass: Record<Tone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  error: 'bg-red-500/15 text-red-500 border-red-500/30',
  muted: 'bg-muted text-muted-foreground border-border',
};
```

- [ ] **Step 3 : implémenter `StatusBanner.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Play, Square, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { serverApi } from '@/api/server.api';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { formatUptime } from '@/lib/utils';
import { statusTone, toneClass } from '@/lib/format';
import { cn } from '@/lib/utils';

export function StatusBanner() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const pushed = useServerStore((s) => s.info);
  const { data: fetched } = useQuery({ queryKey: ['server'], queryFn: serverApi.get, enabled: !pushed });
  const info = pushed ?? fetched;
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null);

  const act = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart') => serverApi[a](),
    onSuccess: () => { toast.success(t('server.actionAccepted')); void qc.invalidateQueries({ queryKey: ['server'] }); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? t('shared.error')),
  });

  if (!info) return null;
  const tone = statusTone(info.status);
  const busy = act.isPending || info.status === 'starting' || info.status === 'stopping';

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
      <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide', toneClass[tone])}>{t(`server.status.${info.status}`)}</span>
      <div className="text-sm text-muted-foreground">
        <span className="font-mono">{info.containerName}</span>
        {info.version && <span className="ml-2">· {info.version}</span>}
        {info.uptimeSeconds != null && <span className="ml-2">· {t('server.uptime')} {formatUptime(info.uptimeSeconds)}</span>}
      </div>
      {info.message && <p className="w-full text-xs text-red-500">{info.message}</p>}
      {isAdmin && (
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={busy || info.status !== 'stopped'} onClick={() => act.mutate('start')}><Play className="mr-1 h-4 w-4" />{t('server.start')}</Button>
          <Button size="sm" variant="outline" disabled={busy || info.status === 'stopped' || info.status === 'unavailable'} onClick={() => setConfirm('restart')}><RotateCcw className="mr-1 h-4 w-4" />{t('server.restart')}</Button>
          <Button size="sm" variant="destructive" disabled={busy || info.status === 'stopped' || info.status === 'unavailable'} onClick={() => setConfirm('stop')}><Square className="mr-1 h-4 w-4" />{t('server.stop')}</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}
        title={t(`server.confirm.${confirm ?? 'stop'}.title`)} description={t(`server.confirm.${confirm ?? 'stop'}.description`)}
        destructive loading={act.isPending}
        onConfirm={() => { if (confirm) act.mutate(confirm); setConfirm(null); }}
      />
    </div>
  );
}
```

`Dashboard.tsx` devient :

```tsx
import { StatusBanner } from '@/components/dashboard/StatusBanner';
export default function Dashboard() {
  return <div className="space-y-5"><StatusBanner /></div>;
}
```

- [ ] **Step 4 : test de `LogView`**

```tsx
// src/components/console/LogView.test.tsx
import { render, screen } from '@testing-library/react';
import { LogView } from './LogView';
const L = (level: 'INFO' | 'WARN' | 'ERROR' | 'RAW', message: string) => ({ ts: '10:00:00', level, thread: 'main', message, raw: message });

describe('LogView', () => {
  it('filters by level and text', () => {
    render(<LogView lines={[L('INFO', 'player joined'), L('WARN', 'lag spike'), L('ERROR', 'boom')]} filter="o" level="all" />);
    expect(screen.getByText('player joined')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByText('lag spike')).not.toBeInTheDocument();
  });
  it('keeps only warnings and errors when level is warn', () => {
    render(<LogView lines={[L('INFO', 'a'), L('WARN', 'b'), L('ERROR', 'c')]} filter="" level="warn" />);
    expect(screen.queryByText('a')).not.toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('c')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5 : implémenter `LogView.tsx`**

```tsx
import { useEffect, useMemo, useRef } from 'react';
import type { LogLine } from '@mc/common';
import { cn } from '@/lib/utils';

export type LevelFilter = 'all' | 'warn' | 'error';
const levelClass: Record<LogLine['level'], string> = { INFO: 'text-foreground', WARN: 'text-amber-500', ERROR: 'text-red-500', DEBUG: 'text-muted-foreground', RAW: 'text-muted-foreground' };

export function filterLines(lines: LogLine[], filter: string, level: LevelFilter): LogLine[] {
  const q = filter.trim().toLowerCase();
  return lines.filter((l) => {
    if (level === 'warn' && l.level !== 'WARN' && l.level !== 'ERROR') return false;
    if (level === 'error' && l.level !== 'ERROR') return false;
    return !q || l.raw.toLowerCase().includes(q);
  });
}

export function LogView({ lines, filter, level, paused = false }: { lines: LogLine[]; filter: string; level: LevelFilter; paused?: boolean }) {
  const visible = useMemo(() => filterLines(lines, filter, level), [lines, filter, level]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!paused) endRef.current?.scrollIntoView({ block: 'end' }); }, [visible.length, paused]);
  return (
    <div className="h-full overflow-auto rounded-md border bg-black/40 p-3 font-mono text-xs leading-5">
      {visible.map((l, i) => (
        <div key={i} className={cn('whitespace-pre-wrap break-all', levelClass[l.level])}>
          {l.ts && <span className="mr-2 text-muted-foreground">{l.ts}</span>}
          {l.thread && <span className="mr-2 text-muted-foreground/70">[{l.thread}]</span>}
          <span>{l.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
```

`Console.tsx` (le champ de commande arrive en tâche 11) :

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { useServerStore } from '@/stores/server.store';
import { LogView, type LevelFilter } from '@/components/console/LogView';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function Console() {
  const { t } = useTranslation();
  const logs = useServerStore((s) => s.logs);
  const connected = useServerStore((s) => s.connected);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(logs);
  const togglePause = () => { if (!paused) setFrozen(logs); setPaused(!paused); };
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{t('console.title')}</h1>
        <span className={connected ? 'text-xs text-emerald-500' : 'text-xs text-red-500'}>{connected ? t('console.live') : t('console.disconnected')}</span>
        <div className="ml-auto flex items-center gap-2">
          <Input className="h-8 w-56" placeholder={t('console.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Select value={level} onValueChange={(v) => setLevel(v as LevelFilter)}>
            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">{t('console.levelAll')}</SelectItem><SelectItem value="warn">{t('console.levelWarn')}</SelectItem><SelectItem value="error">{t('console.levelError')}</SelectItem></SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={togglePause}>{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1"><LogView lines={paused ? frozen : logs} filter={filter} level={level} paused={paused} /></div>
    </div>
  );
}
```

- [ ] **Step 6 : fragment i18n `scripts/i18n-fragments/server.json`**

```json
{ "namespace": "server", "keys": {
  "en": { "status": { "unavailable": "Unavailable", "stopped": "Stopped", "starting": "Starting", "ready": "Online", "unhealthy": "Unhealthy", "stopping": "Stopping" },
          "uptime": "up", "start": "Start", "stop": "Stop", "restart": "Restart", "actionAccepted": "Command sent",
          "confirm": { "stop": { "title": "Stop the server?", "description": "Connected players will be disconnected. The world is saved before shutdown." },
                       "restart": { "title": "Restart the server?", "description": "Connected players will be disconnected for about a minute." } } },
  "fr": { "status": { "unavailable": "Indisponible", "stopped": "Arrêté", "starting": "Démarrage", "ready": "En ligne", "unhealthy": "Dégradé", "stopping": "Arrêt en cours" },
          "uptime": "depuis", "start": "Démarrer", "stop": "Arrêter", "restart": "Redémarrer", "actionAccepted": "Commande envoyée",
          "confirm": { "stop": { "title": "Arrêter le serveur ?", "description": "Les joueurs connectés seront déconnectés. Le monde est sauvegardé avant l'arrêt." },
                       "restart": { "title": "Redémarrer le serveur ?", "description": "Les joueurs connectés seront déconnectés pendant environ une minute." } } }
} }
```

et `console.json` avec `title`, `live`, `disconnected`, `filter`, `levelAll`, `levelWarn`, `levelError`, `commandPlaceholder`, `send` (EN/FR). Ajouter `shared.error` si absent. Lancer `pnpm --filter @mc/frontend run i18n:merge`.

- [ ] **Step 7 : tests, build, vérification manuelle, commit**

```bash
pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck && pnpm lint
```

Manuel : avec un conteneur `mc` réel sur l'hôte Docker local (ou `MC_CONTAINER` pointant sur n'importe quel conteneur pour l'état), le bandeau reflète start/stop, la console affiche les logs.

```bash
git add -A && git commit -m "feat(frontend): bandeau d'état du serveur et console de logs"
```

---

### Task 11 : RCON, parseurs et commande depuis la console

**Files:**
- Create: `packages/backend/src/rcon/rcon-like.ts`, `src/rcon/parsers.ts`, `src/rcon/rcon-service.ts`
- Create: `packages/frontend/src/components/console/CommandInput.tsx`
- Modify: `packages/backend/src/routes/server.routes.ts`, `src/index.ts`, `packages/frontend/src/pages/Console.tsx`
- Test: `src/rcon/parsers.test.ts`, `src/rcon/rcon-service.test.ts`, `src/routes/server.routes.test.ts`, `src/components/console/CommandInput.test.tsx`

**Interfaces:**
- Produces: `stripColors(s)`, `parseList(s): { online, max, names } | null`, `parseTickQuery(s): { mspt, targetRate } | null`, `parseTps(s): number | null` ; `interface RconLike { connect(opts): Promise<RconConnection> }`, `class RconService` : `start()`, `stop()`, `isConnected()`, `send(cmd): Promise<string>` ; `POST /api/server/command`.

- [ ] **Step 1 : test des parseurs**

```ts
import { describe, it, expect } from 'vitest';
import { parseList, parseTickQuery, parseTps, stripColors } from './parsers.js';

describe('parseList', () => {
  it('parses players', () => expect(parseList('There are 2 of a max of 20 players online: Alice, Bob')).toEqual({ online: 2, max: 20, names: ['Alice', 'Bob'] }));
  it('parses empty', () => expect(parseList('There are 0 of a max of 20 players online: ')).toEqual({ online: 0, max: 20, names: [] }));
  it('returns null on garbage', () => expect(parseList('Unknown or incomplete command')).toBeNull());
});

describe('parseTickQuery', () => {
  it('parses 1.20.3+ output', () => {
    expect(parseTickQuery('Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)\nPercentiles: P50: 2.9ms P95: 5.1ms P99: 9.0ms, sample: 100')).toEqual({ mspt: 3.2, targetRate: 20 });
  });
  it('returns null when the command is unknown (pre-1.20.3)', () => expect(parseTickQuery('Unknown or incomplete command, see below for error')).toBeNull());
  it('ignores colour codes', () => expect(parseTickQuery('§aTarget tick rate: §f20.0§a per second.\n§aAverage time per tick: §f1.5ms')?.mspt).toBe(1.5));
});

describe('parseTps', () => {
  it('parses Paper output', () => expect(parseTps('§6TPS from last 1m, 5m, 15m: §a*20.0, §a20.0, §a19.98')).toBe(20));
  it('returns null otherwise', () => expect(parseTps('Unknown command')).toBeNull());
});

it('stripColors removes § sequences', () => expect(stripColors('§aok§r')).toBe('ok'));
```

- [ ] **Step 2 : implémenter `parsers.ts`**

```ts
export const stripColors = (s: string) => s.replace(/§[0-9a-fk-or]/gi, '');

export function parseList(raw: string): { online: number; max: number; names: string[] } | null {
  const m = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/s.exec(stripColors(raw));
  if (!m) return null;
  const names = m[3].split(',').map((n) => n.trim()).filter(Boolean);
  return { online: parseInt(m[1], 10), max: parseInt(m[2], 10), names };
}

export function parseTickQuery(raw: string): { mspt: number; targetRate: number } | null {
  const s = stripColors(raw);
  const avg = /Average time per tick:\s*([\d.]+)\s*ms/i.exec(s);
  if (!avg) return null;
  const rate = /Target tick rate:\s*([\d.]+)/i.exec(s);
  return { mspt: parseFloat(avg[1]), targetRate: rate ? parseFloat(rate[1]) : 20 };
}

export function parseTps(raw: string): number | null {
  const m = /TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)/i.exec(stripColors(raw));
  return m ? parseFloat(m[1]) : null;
}
```

- [ ] **Step 3 : `rcon-like.ts` et test de `RconService`**

```ts
// rcon-like.ts
export interface RconConnection {
  send(cmd: string): Promise<string>;
  end(): Promise<void> | void;
  on(event: 'end' | 'error', cb: (err?: Error) => void): void;
}
export interface RconLike { connect(opts: { host: string; port: number; password: string; timeout: number }): Promise<RconConnection> }
```

```ts
// rcon-service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { RconService } from './rcon-service.js';
import type { RconLike, RconConnection } from './rcon-like.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeConn extends EventEmitter implements RconConnection {
  sent: string[] = [];
  async send(cmd: string) { this.sent.push(cmd); return `ok:${cmd}`; }
  end() { this.emit('end'); }
}

function setup(status: 'ready' | 'stopped' = 'ready') {
  const docker = new FakeDocker();
  docker.containers.set('mc', new FakeContainer(inspectFixture(status === 'stopped' ? { Status: 'exited', Running: false } : {})));
  const svc = new DockerService(docker, 'mc', 'mc-backup');
  const conns: FakeConn[] = [];
  const rconLib: RconLike = { connect: vi.fn(async () => { const c = new FakeConn(); conns.push(c); return c; }) };
  const credentials = vi.fn(async () => ({ enabled: true, port: 25575, password: 'pw' }));
  const rcon = new RconService(rconLib, svc, { host: 'mc', portFallback: 25575 }, credentials);
  return { docker, svc, rcon, rconLib, conns, credentials };
}

describe('RconService', () => {
  it('connects only when the server is ready and sends commands sequentially', async () => {
    const { svc, rcon, conns } = setup();
    await svc.start(); await rcon.start(); await wait(10);
    expect(conns).toHaveLength(1);
    const [a, b] = await Promise.all([rcon.send('list'), rcon.send('tps')]);
    expect(a).toBe('ok:list'); expect(b).toBe('ok:tps');
    expect(conns[0].sent).toEqual(['list', 'tps']);
    rcon.stop(); svc.stop();
  });

  it('does not connect while stopped and rejects send with 503', async () => {
    const { svc, rcon, rconLib } = setup('stopped');
    await svc.start(); await rcon.start(); await wait(10);
    expect(rconLib.connect).not.toHaveBeenCalled();
    await expect(rcon.send('list')).rejects.toMatchObject({ statusCode: 503 });
    rcon.stop(); svc.stop();
  });

  it('reconnects with backoff after the connection ends', async () => {
    const { svc, rcon, conns } = setup();
    await svc.start(); await rcon.start(); await wait(10);
    conns[0].end();
    await wait(1100);
    expect(conns).toHaveLength(2);
    rcon.stop(); svc.stop();
  });

  it('reads the password from server.properties, refusing when rcon is disabled', async () => {
    const { svc, rcon, credentials, rconLib } = setup();
    credentials.mockResolvedValueOnce({ enabled: false, port: 25575, password: null });
    await svc.start(); await rcon.start(); await wait(10);
    expect(rconLib.connect).not.toHaveBeenCalled();
    rcon.stop(); svc.stop();
  });
});
```

- [ ] **Step 4 : implémenter `rcon-service.ts`**

```ts
import { Rcon } from 'rcon-client';
import type { ServerStatus } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import type { RconLike, RconConnection } from './rcon-like.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export const realRcon: RconLike = { connect: (opts) => Rcon.connect(opts) as unknown as Promise<RconConnection> };

type Credentials = () => Promise<{ enabled: boolean; port: number; password: string | null }>;

export class RconService {
  private conn: RconConnection | null = null;
  private connecting = false;
  private stopped = false;
  private retryMs = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private onStatus = (s: ServerStatus) => { if (s === 'ready') void this.connect(); else this.disconnect(); };

  constructor(private lib: RconLike, private docker: DockerService, private opts: { host: string; portFallback: number }, private credentials: Credentials) {}

  isConnected(): boolean { return this.conn !== null; }

  async start(): Promise<void> {
    this.stopped = false;
    this.docker.on('status', this.onStatus);
    if (this.docker.getStatus() === 'ready') await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.docker.off('status', this.onStatus);
    this.disconnect();
  }

  private disconnect(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const c = this.conn; this.conn = null;
    if (c) { try { void c.end(); } catch { /* déjà fermée */ } }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.conn || this.connecting) return;
    if (this.docker.getStatus() !== 'ready') return;
    this.connecting = true;
    try {
      const cred = await this.credentials();
      if (!cred.enabled || !cred.password) { logger.warn('rcon disabled in server.properties'); return; }
      const c = await this.lib.connect({ host: this.opts.host, port: cred.port || this.opts.portFallback, password: cred.password, timeout: 10_000 });
      c.on('end', () => { if (this.conn === c) { this.conn = null; this.scheduleRetry(); } });
      c.on('error', (err) => logger.warn({ err }, 'rcon error'));
      this.conn = c;
      this.retryMs = 1000;
      logger.info('rcon connected');
    } catch (err) {
      logger.warn({ err }, 'rcon connect failed');
      this.scheduleRetry();
    } finally { this.connecting = false; }
  }

  send(cmd: string): Promise<string> {
    const run = async () => {
      const c = this.conn;
      if (!c) throw new AppError(503, 'RCON not connected');
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new AppError(504, 'RCON command timed out')), 10_000));
      return Promise.race([c.send(cmd), timeout]);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
```

- [ ] **Step 5 : lancer les tests rcon**

```bash
pnpm --filter @mc/backend exec vitest run src/rcon
```

- [ ] **Step 6 : route `POST /api/server/command` et test**

Ajouter au test des routes serveur (`app.locals.rcon = { send: vi.fn().mockResolvedValue('There are 0 of a max of 20 players online:') }` dans `appWith`) :

```ts
it('viewer cannot send commands', async () => {
  expect((await request(appWith('viewer', docker)).post('/api/server/command').send({ command: 'list' })).status).toBe(403);
});
it('admin command is forwarded, audited and answered', async () => {
  const app = appWith('admin', docker);
  const res = await request(app).post('/api/server/command').send({ command: 'list' });
  expect(res.status).toBe(200);
  expect(res.body.response).toContain('players online');
  expect(app.locals.rcon.send).toHaveBeenCalledWith('list');
  expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'rcon.command', detail: 'list' }) }));
});
it('rejects an empty or oversized command', async () => {
  expect((await request(appWith('admin', docker)).post('/api/server/command').send({ command: '' })).status).toBe(400);
  expect((await request(appWith('admin', docker)).post('/api/server/command').send({ command: 'x'.repeat(2000) })).status).toBe(400);
});
```

Implémentation dans `server.routes.ts` (ajouter les imports `AppError` depuis `../middleware/error-handler.js` et `stripColors` depuis `../rcon/parsers.js`) :

```ts
serverRoutes.post('/command', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const command = typeof req.body?.command === 'string' ? req.body.command.trim().replace(/^\//, '') : '';
    if (!command || command.length > 1000) throw new AppError(400, 'command must be 1 to 1000 characters');
    const response = stripColors(await req.app.locals.rcon.send(command));
    await audit(req, 'rcon.command', command);
    res.json({ response });
  } catch (err) { next(err); }
});
```

Dans `index.ts` :

```ts
import { RconService, realRcon } from './rcon/rcon-service.js';
import { rconSettings } from './utils/server-properties.js';
const rcon = new RconService(realRcon, docker, { host: config.mc.rconHost, portFallback: config.mc.rconPort },
  async () => rconSettings(await readServerProperties(config.mc.dataDir)));
app.locals.rcon = rcon;
await rcon.start();
// shutdown : rcon.stop();
```

- [ ] **Step 7 : test et composant `CommandInput`**

```tsx
// CommandInput.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandInput } from './CommandInput';

describe('CommandInput', () => {
  it('submits on Enter and navigates history with arrows', () => {
    const onSend = vi.fn().mockResolvedValue('ok');
    render(<CommandInput onSend={onSend} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'list' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('list');
    fireEvent.change(input, { target: { value: 'tps' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('tps');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect((input as HTMLInputElement).value).toBe('list');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect((input as HTMLInputElement).value).toBe('tps');
  });
});
```

```tsx
// CommandInput.tsx
import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';

export function CommandInput({ onSend }: { onSend: (cmd: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() && !busy) {
      const cmd = value.trim();
      setHistory((h) => [...h.filter((x) => x !== cmd), cmd].slice(-50));
      setCursor(null); setValue(''); setBusy(true);
      try { await onSend(cmd); } finally { setBusy(false); }
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next); setValue(history[next]);
    } else if (e.key === 'ArrowDown' && cursor !== null) {
      e.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) { setCursor(null); setValue(''); } else { setCursor(next); setValue(history[next]); }
    }
  };

  return <Input className="font-mono" placeholder={t('console.commandPlaceholder')} value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} />;
}
```

Dans `Console.tsx`, pour un admin, sous le `LogView` :

```tsx
{isAdmin && <CommandInput onSend={async (cmd) => {
  try { const { response } = await serverApi.command(cmd); setEcho((e) => [...e, { cmd, response }].slice(-20)); }
  catch (err) { toast.error((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('shared.error')); }
}} />}
```

avec `echo` affiché sous forme de lignes `> cmd` puis la réponse, en ajoutant au store via `apply({ type: 'log.line', line: { ts: null, level: 'RAW', thread: null, message: `> ${cmd}\n${response}`, raw: … } })` pour qu'elles apparaissent dans le flux.

- [ ] **Step 8 : tests, typecheck, commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A && git commit -m "feat: RCON persistant, parseurs et commandes depuis la console"
```

---

### Task 12 : collecteur de métriques, agrégation et route

**Files:**
- Create: `packages/backend/src/metrics/collector.ts`, `src/metrics/aggregate.ts`, `src/metrics/series.ts`, `src/metrics/disk.ts`, `src/routes/metrics.routes.ts`
- Modify: `src/index.ts`, `src/app.ts`
- Test: `src/metrics/aggregate.test.ts`, `src/metrics/collector.test.ts`, `src/metrics/series.test.ts`

**Interfaces:**
- Produces: `class MetricsCollector` : `start()`, `stop()`, `latest(): LatestMetrics`, `tick(): Promise<void>` ; `aggregateHour(prisma, hour: Date)`, `purgeSamples(prisma, olderThan)`, `purgeHourly(prisma, olderThan)` ; `querySeries(prisma, range): Promise<MetricPoint[]>` ; `dirSize(path)`, `diskFree(path)` ; `GET /api/metrics?range=`.

- [ ] **Step 1 : test de `aggregate.ts` contre une base SQLite temporaire**

Ajouter un helper `src/test-db.ts` :

```ts
import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PrismaClient } from '../generated/prisma/index.js';

export function testPrisma(): PrismaClient {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-test-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  execSync('npx prisma db push --skip-generate --accept-data-loss', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  return new PrismaClient({ datasources: { db: { url } } });
}
```

```ts
// aggregate.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { aggregateHour, purgeSamples } from './aggregate.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

describe('aggregateHour', () => {
  beforeAll(async () => {
    const hour = new Date('2026-10-10T10:00:00Z');
    await prisma.metricSample.createMany({ data: [
      { at: new Date('2026-10-10T10:00:15Z'), status: 'ready', players: 2, cpuPercent: 10, memUsed: 1000n, mspt: 2 },
      { at: new Date('2026-10-10T10:30:00Z'), status: 'ready', players: 4, cpuPercent: 30, memUsed: 3000n, mspt: 6 },
      { at: new Date('2026-10-10T11:00:00Z'), status: 'ready', players: 9, cpuPercent: 90, memUsed: 9000n, mspt: 9 },
      { at: new Date('2026-10-10T10:45:00Z'), status: 'stopped' },
    ] });
    await aggregateHour(prisma, hour);
  });
  it('averages and maxes only samples of that hour, ignoring null fields', async () => {
    const row = await prisma.metricHourly.findUnique({ where: { hour: new Date('2026-10-10T10:00:00Z') } });
    expect(row).toMatchObject({ playersAvg: 3, playersMax: 4, cpuAvg: 20, memAvg: 2000n, msptAvg: 4, msptMax: 6, samples: 3 });
  });
  it('is idempotent', async () => {
    await aggregateHour(prisma, new Date('2026-10-10T10:00:00Z'));
    expect(await prisma.metricHourly.count()).toBe(1);
  });
  it('purgeSamples removes old rows only', async () => {
    await purgeSamples(prisma, new Date('2026-10-10T10:40:00Z'));
    expect(await prisma.metricSample.count()).toBe(2);
  });
});
```

- [ ] **Step 2 : implémenter `aggregate.ts`**

```ts
import type { PrismaClient } from '../../generated/prisma/index.js';

export async function aggregateHour(prisma: PrismaClient, hour: Date): Promise<void> {
  const start = new Date(hour); start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  const rows = await prisma.metricSample.findMany({ where: { at: { gte: start, lt: end }, players: { not: null } } });
  if (rows.length === 0) return;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const nums = (f: (r: typeof rows[number]) => number | null | undefined) => rows.map(f).filter((x): x is number => typeof x === 'number');
  const mems = rows.map((r) => r.memUsed).filter((x): x is bigint => x != null);
  const data = {
    playersAvg: avg(nums((r) => r.players)) ?? 0,
    playersMax: Math.max(0, ...nums((r) => r.players)),
    cpuAvg: avg(nums((r) => r.cpuPercent)),
    memAvg: mems.length ? mems.reduce((a, b) => a + b, 0n) / BigInt(mems.length) : null,
    msptAvg: avg(nums((r) => r.mspt)),
    msptMax: nums((r) => r.mspt).length ? Math.max(...nums((r) => r.mspt)) : null,
    worldBytes: rows.map((r) => r.worldBytes).filter((x) => x != null).at(-1) ?? null,
    samples: rows.length,
  };
  await prisma.metricHourly.upsert({ where: { hour: start }, create: { hour: start, ...data }, update: data });
}

export const purgeSamples = (prisma: PrismaClient, olderThan: Date) => prisma.metricSample.deleteMany({ where: { at: { lt: olderThan } } });
export const purgeHourly = (prisma: PrismaClient, olderThan: Date) => prisma.metricHourly.deleteMany({ where: { hour: { lt: olderThan } } });
```

- [ ] **Step 3 : test et implémentation de `series.ts`**

```ts
// series.test.ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { querySeries, bucketMinute } from './series.js';
const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

it('bucketMinute floors to the minute', () => expect(bucketMinute(new Date('2026-10-10T10:00:45Z')).toISOString()).toBe('2026-10-10T10:00:00.000Z'));

describe('querySeries', () => {
  beforeAll(async () => {
    const now = Date.now();
    await prisma.metricSample.createMany({ data: [
      { at: new Date(now - 60_000), status: 'ready', players: 1, cpuPercent: 10, memUsed: 100n, mspt: 1 },
      { at: new Date(now - 45_000), status: 'ready', players: 3, cpuPercent: 30, memUsed: 300n, mspt: 3 },
      { at: new Date(now - 30 * 3_600_000), status: 'ready', players: 7 },
    ] });
    await prisma.metricHourly.create({ data: { hour: new Date(now - 5 * 86_400_000), playersAvg: 2, playersMax: 5, cpuAvg: 1, memAvg: 1n, msptAvg: 1, msptMax: 1, samples: 10 } });
  });
  it('24h averages samples per minute within the window', async () => {
    const pts = await querySeries(prisma, '24h');
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ players: 2, cpuPercent: 20, memUsed: 200, mspt: 2 });
  });
  it('7d reads hourly rows', async () => {
    const pts = await querySeries(prisma, '7d');
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ players: 2, playersMax: 5 });
  });
});
```

```ts
// series.ts
import type { MetricPoint, MetricsRange } from '@mc/common';
import type { PrismaClient } from '../../generated/prisma/index.js';

export const bucketMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

export async function querySeries(prisma: PrismaClient, range: MetricsRange): Promise<MetricPoint[]> {
  const now = Date.now();
  if (range === '24h') {
    const rows = await prisma.metricSample.findMany({ where: { at: { gte: new Date(now - 86_400_000) } }, orderBy: { at: 'asc' } });
    const buckets = new Map<string, { n: number; players: number[]; cpu: number[]; mem: number[]; mspt: number[] }>();
    for (const r of rows) {
      const k = bucketMinute(r.at).toISOString();
      const b = buckets.get(k) ?? { n: 0, players: [], cpu: [], mem: [], mspt: [] };
      b.n++;
      if (r.players != null) b.players.push(r.players);
      if (r.cpuPercent != null) b.cpu.push(r.cpuPercent);
      if (r.memUsed != null) b.mem.push(Number(r.memUsed));
      if (r.mspt != null) b.mspt.push(r.mspt);
      buckets.set(k, b);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);
    return [...buckets.entries()].map(([at, b]) => ({ at, players: avg(b.players), cpuPercent: avg(b.cpu), memUsed: avg(b.mem), mspt: avg(b.mspt) }));
  }
  const days = range === '7d' ? 7 : 30;
  const rows = await prisma.metricHourly.findMany({ where: { hour: { gte: new Date(now - days * 86_400_000) } }, orderBy: { hour: 'asc' } });
  return rows.map((r) => ({ at: r.hour.toISOString(), players: r.playersAvg, playersMax: r.playersMax, cpuPercent: r.cpuAvg, memUsed: r.memAvg == null ? null : Number(r.memAvg), mspt: r.msptAvg }));
}
```

- [ ] **Step 4 : `disk.ts`**

```ts
import { readdir, stat, statfs } from 'fs/promises';
import path from 'path';

export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export async function diskFree(dir: string): Promise<number | null> {
  try { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}
```

- [ ] **Step 5 : test de `MetricsCollector`**

```ts
// collector.test.ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { MetricsCollector } from './collector.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

function deps(over: Partial<ConstructorParameters<typeof MetricsCollector>[1]> = {}) {
  return {
    status: () => 'ready' as const,
    stats: async () => ({ cpuPercent: 12, memUsed: 500, memLimit: 1000 }),
    rcon: async (cmd: string) => (cmd === 'list' ? 'There are 1 of a max of 20 players online: Alice' : cmd === 'tick query' ? 'Average time per tick: 4.0ms' : 'Unknown command'),
    worldSize: async () => 1234,
    diskFree: async () => 999,
    broadcast: vi.fn(),
    serverInfo: async () => ({ status: 'ready' }) as never,
    ...over,
  };
}

describe('MetricsCollector', () => {
  it('stores a full sample when ready and exposes latest()', async () => {
    const d = deps();
    const c = new MetricsCollector(prisma, d, { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    const row = await prisma.metricSample.findFirst({ orderBy: { id: 'desc' } });
    expect(row).toMatchObject({ status: 'ready', players: 1, cpuPercent: 12, mspt: 4, tps: null, worldBytes: 1234n });
    expect(c.latest()).toMatchObject({ players: { online: 1, max: 20, names: ['Alice'] }, mspt: 4, worldBytes: 1234 });
    expect(d.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'metrics.tick' }));
  });

  it('stores mspt null when tick query is unknown (pre-1.20.3)', async () => {
    const c = new MetricsCollector(prisma, deps({ rcon: async (cmd) => (cmd === 'list' ? 'There are 0 of a max of 20 players online:' : 'Unknown or incomplete command') }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    const row = await prisma.metricSample.findFirst({ orderBy: { id: 'desc' } });
    expect(row?.mspt).toBeNull();
    expect(row?.players).toBe(0);
  });

  it('skips rcon fields when the server is not ready', async () => {
    const rcon = vi.fn();
    const c = new MetricsCollector(prisma, deps({ status: () => 'stopped' as const, rcon }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    const row = await prisma.metricSample.findFirst({ orderBy: { id: 'desc' } });
    expect(row).toMatchObject({ status: 'stopped', players: null });
    expect(rcon).not.toHaveBeenCalled();
  });

  it('survives an rcon failure', async () => {
    const c = new MetricsCollector(prisma, deps({ rcon: async () => { throw new Error('down'); } }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await expect(c.tick()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6 : implémenter `collector.ts`**

```ts
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { ServerInfo, ServerStats, ServerStatus, WsMessage } from '@mc/common';
import { parseList, parseTickQuery, parseTps } from '../rcon/parsers.js';
import { aggregateHour, purgeHourly, purgeSamples } from './aggregate.js';
import { logger } from '../utils/logger.js';

export interface CollectorDeps {
  status: () => ServerStatus;
  stats: () => Promise<ServerStats>;
  rcon: (cmd: string) => Promise<string>;
  worldSize: () => Promise<number>;
  diskFree: () => Promise<number | null>;
  broadcast: (msg: WsMessage) => void;
  serverInfo: () => Promise<ServerInfo>;
}

export interface LatestMetrics {
  players: { online: number; max: number; names: string[] } | null;
  mspt: number | null;
  tps: number | null;
  worldBytes: number | null;
  diskFree: number | null;
  version: string | null;
}

export class MetricsCollector {
  private last: LatestMetrics = { players: null, mspt: null, tps: null, worldBytes: null, diskFree: null, version: null };
  private lastDiskAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private hourTimer: ReturnType<typeof setInterval> | null = null;
  private tpsSupported: boolean | null = null;

  constructor(private prisma: PrismaClient, private deps: CollectorDeps, private opts: { intervalMs: number; diskIntervalMs: number }) {}

  latest(): LatestMetrics { return this.last; }

  setVersion(v: string | null): void { this.last = { ...this.last, version: v }; }

  start(): void {
    void this.tick();
    this.tickTimer = setInterval(() => void this.tick(), this.opts.intervalMs);
    this.hourTimer = setInterval(() => void this.hourly(), 3_600_000);
    void this.hourly();
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.hourTimer) clearInterval(this.hourTimer);
  }

  async tick(): Promise<void> {
    const status = this.deps.status();
    let players: LatestMetrics['players'] = null;
    let mspt: number | null = null;
    let tps: number | null = null;
    let stats: ServerStats = { cpuPercent: null, memUsed: null, memLimit: null };

    if (status === 'ready') {
      stats = await this.deps.stats().catch(() => stats);
      try {
        players = parseList(await this.deps.rcon('list'));
        mspt = parseTickQuery(await this.deps.rcon('tick query'))?.mspt ?? null;
        if (this.tpsSupported !== false) {
          tps = parseTps(await this.deps.rcon('tps'));
          if (this.tpsSupported === null) this.tpsSupported = tps !== null;
        }
      } catch (err) { logger.debug({ err }, 'rcon metrics skipped'); }
    }

    const now = Date.now();
    if (now - this.lastDiskAt >= this.opts.diskIntervalMs) {
      this.lastDiskAt = now;
      const [worldBytes, diskFree] = await Promise.all([this.deps.worldSize().catch(() => null), this.deps.diskFree().catch(() => null)]);
      this.last = { ...this.last, worldBytes, diskFree };
    }

    this.last = { ...this.last, players, mspt, tps };
    try {
      await this.prisma.metricSample.create({ data: {
        status, players: players?.online ?? null, playerNames: players ? JSON.stringify(players.names) : null,
        cpuPercent: stats.cpuPercent, memUsed: stats.memUsed == null ? null : BigInt(Math.round(stats.memUsed)), memLimit: stats.memLimit == null ? null : BigInt(Math.round(stats.memLimit)),
        mspt, tps, worldBytes: this.last.worldBytes == null ? null : BigInt(this.last.worldBytes), diskFree: this.last.diskFree == null ? null : BigInt(this.last.diskFree),
      } });
    } catch (err) { logger.error({ err }, 'metric sample write failed'); }

    try { this.deps.broadcast({ type: 'metrics.tick', info: await this.deps.serverInfo() }); } catch { /* pas de client */ }
  }

  async hourly(): Promise<void> {
    try {
      const prev = new Date(Date.now() - 3_600_000);
      await aggregateHour(this.prisma, prev);
      await purgeSamples(this.prisma, new Date(Date.now() - 48 * 3_600_000));
      await purgeHourly(this.prisma, new Date(Date.now() - 400 * 86_400_000));
    } catch (err) { logger.error({ err }, 'hourly aggregation failed'); }
  }
}
```

- [ ] **Step 7 : route `metrics.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { querySeries } from '../metrics/series.js';
import { AppError } from '../middleware/error-handler.js';
export const metricsRoutes: Router = Router();
metricsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = String(req.query.range ?? '24h');
    if (range !== '24h' && range !== '7d' && range !== '30d') throw new AppError(400, 'range must be 24h, 7d or 30d');
    res.json({ range, points: await querySeries(req.app.locals.prisma, range) });
  } catch (err) { next(err); }
});
```

Monter `app.use('/api/metrics', metricsRoutes)` dans `app.ts`. Dans `index.ts` :

```ts
import { MetricsCollector } from './metrics/collector.js';
import { dirSize, diskFree } from './metrics/disk.js';
import path from 'path';
const metrics = new MetricsCollector(prisma, {
  status: () => docker.getStatus(),
  stats: () => docker.stats(),
  rcon: (cmd) => rcon.send(cmd),
  worldSize: () => dirSize(path.join(config.mc.dataDir, 'world')),
  diskFree: () => diskFree(config.mc.dataDir),
  broadcast: (msg) => broadcast(wss, msg),
  serverInfo: () => app.locals.serverInfo(),
}, { intervalMs: 15_000, diskIntervalMs: 5 * 60_000 });
app.locals.metrics = metrics;
metrics.start();
// Version : lue dans les logs au passage à ready ("Starting minecraft server version 1.21.1")
logs.on('line', (l) => { const m = /Starting minecraft server version (\S+)/.exec(l.message); if (m) metrics.setVersion(m[1]); });
// shutdown : metrics.stop();
```

Mettre à jour `app.locals.serverInfo` (tâche 7) pour lire `metrics.latest()` : il le fait déjà via `app.locals.metrics?.latest?.()`.

- [ ] **Step 8 : tests, typecheck, commit**

```bash
pnpm --filter @mc/backend run test && pnpm --filter @mc/backend run typecheck
git add -A && git commit -m "feat(backend): collecteur de métriques, agrégation horaire et séries"
```

---

### Task 13 : Dashboard complet (tuiles, joueurs, courbe)

**Files:**
- Create: `packages/frontend/src/api/metrics.api.ts`, `src/components/dashboard/{StatTiles,PlayersCard,PlayersChart}.tsx`
- Modify: `src/pages/Dashboard.tsx`, fragment i18n `dashboard.json`
- Test: `src/components/dashboard/StatTiles.test.tsx`

**Interfaces:**
- Consumes: `useServerStore().info`, `metricsApi.series(range)`.

- [ ] **Step 1 : `metrics.api.ts`**

```ts
import api from './client';
import type { MetricsRange, MetricsResponse } from '@mc/common';
export const metricsApi = { series: (range: MetricsRange): Promise<MetricsResponse> => api.get('/metrics', { params: { range } }).then((r) => r.data) };
```

- [ ] **Step 2 : test de `StatTiles`**

```tsx
import { render, screen } from '@testing-library/react';
import { StatTiles } from './StatTiles';
it('renders the six tiles with formatted values', () => {
  render(<StatTiles info={{ status: 'ready', containerName: 'mc', startedAt: null, uptimeSeconds: null, version: null, players: { online: 3, max: 20, names: [] }, mspt: 4.26, tps: 20, stats: { cpuPercent: 42.4, memUsed: 2 * 1024 ** 3, memLimit: 4 * 1024 ** 3 }, worldBytes: 1.5 * 1024 ** 3, diskFree: 10 * 1024 ** 3 }} />);
  expect(screen.getByText('3 / 20')).toBeInTheDocument();
  expect(screen.getByText('42 %')).toBeInTheDocument();
  expect(screen.getByText('2 GB / 4 GB')).toBeInTheDocument();
  expect(screen.getByText('4.3 ms')).toBeInTheDocument();
  expect(screen.getByText('1.5 GB')).toBeInTheDocument();
  expect(screen.getByText('10 GB')).toBeInTheDocument();
});
```

- [ ] **Step 3 : implémenter `StatTiles.tsx`, `PlayersCard.tsx`, `PlayersChart.tsx`**

```tsx
// StatTiles.tsx
import { useTranslation } from 'react-i18next';
import { Users, Cpu, MemoryStick, Gauge, Globe, HardDrive } from 'lucide-react';
import type { ServerInfo } from '@mc/common';
import { Card, CardContent } from '@/components/ui/card';
import { formatBytes } from '@/lib/utils';
import { formatMspt, formatPercent } from '@/lib/format';

export function StatTiles({ info }: { info: ServerInfo }) {
  const { t } = useTranslation();
  const tiles = [
    { icon: Users, label: t('dashboard.players'), value: info.players ? `${info.players.online} / ${info.players.max}` : '—' },
    { icon: Cpu, label: t('dashboard.cpu'), value: formatPercent(info.stats.cpuPercent) },
    { icon: MemoryStick, label: t('dashboard.memory'), value: info.stats.memUsed != null && info.stats.memLimit != null ? `${formatBytes(info.stats.memUsed)} / ${formatBytes(info.stats.memLimit)}` : '—' },
    { icon: Gauge, label: info.tps != null ? t('dashboard.tps') : t('dashboard.mspt'), value: info.tps != null ? info.tps.toFixed(1) : formatMspt(info.mspt) },
    { icon: Globe, label: t('dashboard.world'), value: info.worldBytes != null ? formatBytes(info.worldBytes) : '—' },
    { icon: HardDrive, label: t('dashboard.diskFree'), value: info.diskFree != null ? formatBytes(info.diskFree) : '—' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <Card key={tile.label}><CardContent className="flex items-center gap-3 p-4">
          <tile.icon className="h-5 w-5 text-primary" />
          <div><p className="text-xs text-muted-foreground">{tile.label}</p><p className="font-mono text-lg font-semibold">{tile.value}</p></div>
        </CardContent></Card>
      ))}
    </div>
  );
}
```

```tsx
// PlayersCard.tsx
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';
export function PlayersCard({ names }: { names: string[] }) {
  const { t } = useTranslation();
  return (
    <Card><CardHeader><CardTitle className="text-sm">{t('dashboard.onlinePlayers')}</CardTitle></CardHeader>
      <CardContent>{names.length === 0 ? <EmptyState title={t('dashboard.noPlayers')} /> : (
        <ul className="flex flex-wrap gap-2">{names.map((n) => (
          <li key={n} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
            <img src={`https://mc-heads.net/avatar/${encodeURIComponent(n)}/16`} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />{n}
          </li>))}</ul>
      )}</CardContent></Card>
  );
}
```

Vérifier la signature de `EmptyState` copiée en tâche 4 et adapter les props si elle diffère.

```tsx
// PlayersChart.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsRange } from '@mc/common';
import { metricsApi } from '@/api/metrics.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function PlayersChart() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<MetricsRange>('24h');
  const { data } = useQuery({ queryKey: ['metrics', range], queryFn: () => metricsApi.series(range), refetchInterval: 60_000 });
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language, range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit' });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{t('dashboard.playersOverTime')}</CardTitle>
        <Tabs value={range} onValueChange={(v) => setRange(v as MetricsRange)}><TabsList>
          <TabsTrigger value="24h">24h</TabsTrigger><TabsTrigger value="7d">7j</TabsTrigger><TabsTrigger value="30d">30j</TabsTrigger>
        </TabsList></Tabs>
      </CardHeader>
      <CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data?.points ?? []}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="at" tickFormatter={fmt} minTickGap={40} stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} width={28} />
            <Tooltip labelFormatter={(v) => fmt(String(v))} formatter={(v: number) => [v.toFixed(1), t('dashboard.players')]} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
            <Area type="monotone" dataKey="players" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.2} isAnimationActive={false} />
            {range !== '24h' && <Area type="step" dataKey="playersMax" stroke="hsl(var(--chart-2))" fill="none" isAnimationActive={false} />}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

`Dashboard.tsx` :

```tsx
import { useQuery } from '@tanstack/react-query';
import { serverApi } from '@/api/server.api';
import { useServerStore } from '@/stores/server.store';
import { StatusBanner } from '@/components/dashboard/StatusBanner';
import { StatTiles } from '@/components/dashboard/StatTiles';
import { PlayersCard } from '@/components/dashboard/PlayersCard';
import { PlayersChart } from '@/components/dashboard/PlayersChart';

export default function Dashboard() {
  const pushed = useServerStore((s) => s.info);
  const { data: fetched } = useQuery({ queryKey: ['server'], queryFn: serverApi.get, enabled: !pushed });
  const info = pushed ?? fetched;
  return (
    <div className="space-y-5">
      <StatusBanner />
      {info && <StatTiles info={info} />}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2"><PlayersChart /></div>
        <PlayersCard names={info?.players?.names ?? []} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : fragment i18n `dashboard.json`**

Clés EN/FR : `players` (Players / Joueurs), `cpu` (CPU), `memory` (Memory / Mémoire), `mspt` (MSPT), `tps` (TPS), `world` (World size / Taille du monde), `diskFree` (Disk free / Disque libre), `onlinePlayers` (Online players / Joueurs en ligne), `noPlayers` (Nobody online / Personne en ligne), `playersOverTime` (Players over time / Fréquentation). Lancer `i18n:merge`.

- [ ] **Step 5 : tests, build, commit**

```bash
pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck && pnpm --filter @mc/frontend run build
git add -A && git commit -m "feat(frontend): dashboard avec tuiles, joueurs en ligne et courbe de fréquentation"
```

---
### Task 14 : BackupService et routes backups

**Files:**
- Create: `packages/backend/src/backups/backup-service.ts`, `src/routes/backups.routes.ts`
- Modify: `src/index.ts`, `src/app.ts`
- Test: `src/backups/backup-service.test.ts`, `src/routes/backups.routes.test.ts`

**Interfaces:**
- Produces: `isSafeBackupName(name): boolean`, `class BackupService` : `list(): Promise<BackupList>`, `resolve(name): Promise<string>` (chemin absolu ou `AppError 404`), `remove(name)`, `runNow(): Promise<void>` (`AppError 409` si en cours), `isRunning()`, événements `'progress'` `(line: string)`, `'done'` `(exitCode: number)` ; routes `GET /api/backups`, `GET /api/backups/:name/download`, `DELETE /api/backups/:name`, `POST /api/backups/run`.

- [ ] **Step 1 : test de `BackupService`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { BackupService, isSafeBackupName } from './backup-service.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('isSafeBackupName', () => {
  it.each(['world-20261010-100000.tgz', 'a.tar.gz'])('accepts %s', (n) => expect(isSafeBackupName(n)).toBe(true));
  it.each(['../x.tgz', 'a/b.tgz', 'a\\b.tgz', '..', 'x.zip', '', '.tgz', 'x.tgz\n', '%2e%2e/x.tgz'])('rejects %j', (n) => expect(isSafeBackupName(n)).toBe(false));
});

describe('BackupService', () => {
  let dir: string; let docker: FakeDocker; let svc: BackupService; let backupContainer: FakeContainer;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-bk-'));
    writeFileSync(path.join(dir, 'world-20261009-100000.tgz'), 'old');
    writeFileSync(path.join(dir, 'world-20261010-100000.tgz'), 'newer!');
    writeFileSync(path.join(dir, 'notes.txt'), 'x');
    mkdirSync(path.join(dir, 'sub.tgz'));
    utimesSync(path.join(dir, 'world-20261009-100000.tgz'), new Date('2026-10-09T10:00:00Z'), new Date('2026-10-09T10:00:00Z'));
    utimesSync(path.join(dir, 'world-20261010-100000.tgz'), new Date('2026-10-10T10:00:00Z'), new Date('2026-10-10T10:00:00Z'));
    docker = new FakeDocker();
    backupContainer = new FakeContainer(inspectFixture(), undefined, new PassThrough(), new PassThrough(), 0);
    docker.containers.set('mc-backup', backupContainer);
    svc = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists only archive files, newest first, with total size', async () => {
    const l = await svc.list();
    expect(l.entries.map((e) => e.name)).toEqual(['world-20261010-100000.tgz', 'world-20261009-100000.tgz']);
    expect(l.totalBytes).toBe(9);
    expect(l.running).toBe(false);
  });

  it('resolve returns the path for an existing archive and 404 otherwise', async () => {
    expect(await svc.resolve('world-20261009-100000.tgz')).toBe(path.join(dir, 'world-20261009-100000.tgz'));
    await expect(svc.resolve('../world-20261009-100000.tgz')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.resolve('missing.tgz')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.resolve('notes.txt')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.resolve('sub.tgz')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('remove deletes the file', async () => {
    await svc.remove('world-20261009-100000.tgz');
    expect(existsSync(path.join(dir, 'world-20261009-100000.tgz'))).toBe(false);
  });

  it('runNow execs "backup now", streams progress and emits done; a second call is 409', async () => {
    const progress: string[] = []; let done: number | null = null;
    svc.on('progress', (l) => progress.push(l)); svc.on('done', (c) => { done = c; });
    const p = svc.runNow();
    await wait(5);
    expect(svc.isRunning()).toBe(true);
    await expect(svc.runNow()).rejects.toMatchObject({ statusCode: 409 });
    backupContainer.execStream.write('Backing up...\nDone\n');
    backupContainer.execStream.end();
    await p; await wait(5);
    expect(backupContainer.calls).toContain('exec:backup now');
    expect(progress).toEqual(['Backing up...', 'Done']);
    expect(done).toBe(0);
    expect(svc.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2 : implémenter `backup-service.ts`**

```ts
import { EventEmitter } from 'events';
import { readdir, stat, unlink } from 'fs/promises';
import path from 'path';
import { PassThrough } from 'stream';
import type { BackupList } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(tgz|tar\.gz)$/;
export function isSafeBackupName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..') && path.basename(name) === name;
}

export class BackupService extends EventEmitter {
  private running = false;
  constructor(private dir: string, private docker: DockerService) { super(); }

  isRunning(): boolean { return this.running; }

  async list(): Promise<BackupList> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const entries = [];
    for (const name of names) {
      if (!isSafeBackupName(name)) continue;
      const s = await stat(path.join(this.dir, name)).catch(() => null);
      if (!s?.isFile()) continue;
      entries.push({ name, size: s.size, modifiedAt: s.mtime.toISOString() });
    }
    entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return { entries, totalBytes: entries.reduce((n, e) => n + e.size, 0), running: this.running };
  }

  async resolve(name: string): Promise<string> {
    if (!isSafeBackupName(name)) throw new AppError(404, 'Backup not found');
    const full = path.join(this.dir, name);
    if (path.dirname(full) !== path.resolve(this.dir) && path.dirname(full) !== this.dir) throw new AppError(404, 'Backup not found');
    const s = await stat(full).catch(() => null);
    if (!s?.isFile()) throw new AppError(404, 'Backup not found');
    return full;
  }

  async remove(name: string): Promise<void> {
    await unlink(await this.resolve(name));
    this.emit('listChanged');
  }

  async runNow(): Promise<void> {
    if (this.running) throw new AppError(409, 'A backup is already running');
    this.running = true;
    try {
      const { stream, wait } = await this.docker.execBackup(['backup', 'now']);
      const text = new PassThrough();
      this.docker.demux(stream, text);
      let partial = '';
      text.on('data', (chunk: Buffer) => {
        partial += chunk.toString('utf8');
        let nl: number;
        while ((nl = partial.indexOf('\n')) >= 0) { const line = partial.slice(0, nl).replace(/\r$/, ''); partial = partial.slice(nl + 1); if (line) this.emit('progress', line); }
      });
      const code = await wait();
      if (partial.trim()) this.emit('progress', partial.trim());
      this.emit('done', code);
      if (code === 0) this.emit('listChanged');
    } catch (err) {
      logger.error({ err }, 'backup now failed');
      this.emit('progress', `error: ${(err as Error).message}`);
      this.emit('done', 1);
      throw err instanceof AppError ? err : new AppError(503, 'Backup container unavailable');
    } finally { this.running = false; }
  }
}
```

Note : `docker.demux` sur un exec non-TTY démultiplexe ; `FakeDocker.demux` fait un simple `pipe`, ce qui suffit au test.

- [ ] **Step 3 : lancer les tests**

```bash
pnpm --filter @mc/backend exec vitest run src/backups
```

- [ ] **Step 4 : test des routes**

```ts
// backups.routes.test.ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { backupsRoutes } from './backups.routes.js';
import { errorHandler } from '../middleware/error-handler.js';
import { BackupService } from '../backups/backup-service.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker } from '../docker/fake-docker.js';

function appWith(role: 'admin' | 'viewer') {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-bkr-'));
  writeFileSync(path.join(dir, 'w.tgz'), 'content');
  const app = express();
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.backups = new BackupService(dir, new DockerService(new FakeDocker(), 'mc', 'mc-backup'));
  app.use('/api/backups', backupsRoutes);
  app.use(errorHandler);
  return app;
}

describe('backups routes', () => {
  it('viewer can list', async () => { const r = await request(appWith('viewer')).get('/api/backups'); expect(r.status).toBe(200); expect(r.body.entries[0].name).toBe('w.tgz'); });
  it('viewer cannot download, delete or run', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/backups/w.tgz/download')).status).toBe(403);
    expect((await request(app).delete('/api/backups/w.tgz')).status).toBe(403);
    expect((await request(app).post('/api/backups/run')).status).toBe(403);
  });
  it('admin download streams the file with attachment headers and audits', async () => {
    const app = appWith('admin');
    const r = await request(app).get('/api/backups/w.tgz/download');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment; filename="w.tgz"');
    expect(r.text).toBe('content');
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.download', detail: 'w.tgz' }) }));
  });
  it('traversal and unknown names are 404', async () => {
    const app = appWith('admin');
    expect((await request(app).get('/api/backups/..%2Fw.tgz/download')).status).toBe(404);
    expect((await request(app).get('/api/backups/nope.tgz/download')).status).toBe(404);
    expect((await request(app).delete('/api/backups/%2e%2e%2fw.tgz')).status).toBe(404);
  });
  it('admin delete returns 204', async () => { expect((await request(appWith('admin')).delete('/api/backups/w.tgz')).status).toBe(204); });
  it('run returns 503 when the backup container is missing', async () => { expect((await request(appWith('admin')).post('/api/backups/run')).status).toBe(503); });
});
```

- [ ] **Step 5 : implémenter `backups.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';

export const backupsRoutes: Router = Router();

backupsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.backups.list()); } catch (err) { next(err); }
});

backupsRoutes.get('/:name/download', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    const full = await req.app.locals.backups.resolve(name);
    await audit(req, 'backup.download', name);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full)}"`);
    res.sendFile(full, (err) => { if (err && !res.headersSent) next(err); });
  } catch (err) { next(err); }
});

backupsRoutes.delete('/:name', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    await req.app.locals.backups.remove(name);
    await audit(req, 'backup.delete', name);
    res.status(204).send();
  } catch (err) { next(err); }
});

backupsRoutes.post('/run', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const backups = req.app.locals.backups;
    if (backups.isRunning()) { res.status(409).json({ error: 'A backup is already running' }); return; }
    await backups.ensureContainer();
    await audit(req, 'backup.run');
    backups.runNow().catch(() => { /* déjà journalisé et diffusé par le service */ });
    res.status(202).json({ accepted: true });
  } catch (err) { next(err); }
});
```

`ensureContainer()` est à ajouter dans `BackupService` :

```ts
async ensureContainer(): Promise<void> {
  if (!(await this.docker.hasBackupContainer())) throw new AppError(503, 'Backup container not found');
}
```

et `hasBackupContainer()` dans `DockerService` : `return (await this.docker.findByName(this.backupName)) !== null;`. Ajouter au test de `BackupService` : `it('ensureContainer throws 503 when absent', …)` avec un `FakeDocker` sans conteneur `mc-backup`.

Dans `app.ts` : `app.use('/api/backups', backupsRoutes)`. Dans `index.ts` :

```ts
import { BackupService } from './backups/backup-service.js';
const backups = new BackupService(config.mc.backupsDir, docker);
app.locals.backups = backups;
backups.on('progress', (line) => broadcast(wss, { type: 'backup.progress', line }));
backups.on('done', (exitCode) => broadcast(wss, { type: 'backup.done', exitCode }));
backups.on('listChanged', () => broadcast(wss, { type: 'backup.list.changed' }));
```

- [ ] **Step 6 : tests, typecheck, commit**

```bash
pnpm --filter @mc/backend run test && pnpm --filter @mc/backend run typecheck
git add -A && git commit -m "feat(backend): gestion des backups tar et déclenchement manuel"
```

---

### Task 15 : page Backups

**Files:**
- Create: `packages/frontend/src/api/backups.api.ts`, `src/components/backups/{BackupTable,BackupRunPanel}.tsx`
- Modify: `src/pages/Backups.tsx`, `src/stores/server.store.ts` (invalidation sur `backup.list.changed`), fragment i18n `backups.json`
- Test: `src/components/backups/BackupTable.test.tsx`

**Interfaces:**
- Consumes: `useServerStore` (`backupOutput`, `backupRunning`, `startBackupOutput`), `ConfirmDialog`, `DataTable` si sa signature convient (sinon tableau simple).

- [ ] **Step 1 : `backups.api.ts`**

```ts
import api from './client';
import type { BackupList } from '@mc/common';
export const backupsApi = {
  list: (): Promise<BackupList> => api.get('/backups').then((r) => r.data),
  run: () => api.post('/backups/run'),
  remove: (name: string) => api.delete(`/backups/${encodeURIComponent(name)}`),
  downloadUrl: (name: string) => `/api/backups/${encodeURIComponent(name)}/download`,
  download: async (name: string) => {
    const res = await api.get(`/backups/${encodeURIComponent(name)}/download`, { responseType: 'blob', timeout: 0 });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  },
};
```

- [ ] **Step 2 : rafraîchir la liste sur `backup.list.changed`**

Dans `use-websocket.ts`, dans `onmessage`, après `apply(msg)` : `if (msg.type === 'backup.list.changed' || msg.type === 'backup.done') void queryClient.invalidateQueries({ queryKey: ['backups'] });`.

- [ ] **Step 3 : test de `BackupTable`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { BackupTable } from './BackupTable';
const entries = [{ name: 'b.tgz', size: 2048, modifiedAt: '2026-10-10T10:00:00Z' }, { name: 'a.tgz', size: 1024, modifiedAt: '2026-10-09T10:00:00Z' }];
it('renders rows and fires callbacks for admins', () => {
  const onDelete = vi.fn(); const onDownload = vi.fn();
  render(<BackupTable entries={entries} isAdmin onDelete={onDelete} onDownload={onDownload} />);
  expect(screen.getByText('b.tgz')).toBeInTheDocument();
  expect(screen.getByText('2 KB')).toBeInTheDocument();
  fireEvent.click(screen.getAllByLabelText('download')[0]);
  expect(onDownload).toHaveBeenCalledWith('b.tgz');
  fireEvent.click(screen.getAllByLabelText('delete')[1]);
  expect(onDelete).toHaveBeenCalledWith('a.tgz');
});
it('hides actions for viewers', () => {
  render(<BackupTable entries={entries} isAdmin={false} onDelete={vi.fn()} onDownload={vi.fn()} />);
  expect(screen.queryByLabelText('download')).not.toBeInTheDocument();
});
```

- [ ] **Step 4 : implémenter les composants et la page**

```tsx
// BackupTable.tsx
import { useTranslation } from 'react-i18next';
import { Download, Trash2 } from 'lucide-react';
import type { BackupEntry } from '@mc/common';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';

export function BackupTable({ entries, isAdmin, onDelete, onDownload }: { entries: BackupEntry[]; isAdmin: boolean; onDelete: (n: string) => void; onDownload: (n: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('backups.name')}</th><th>{t('backups.date')}</th><th>{t('backups.size')}</th>{isAdmin && <th />}</tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.name} className="border-t">
            <td className="py-2 font-mono">{e.name}</td>
            <td>{new Date(e.modifiedAt).toLocaleString(i18n.language)}</td>
            <td>{formatBytes(e.size)}</td>
            {isAdmin && <td className="text-right">
              <Button size="icon" variant="ghost" aria-label="download" onClick={() => onDownload(e.name)}><Download className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="delete" className="text-destructive" onClick={() => onDelete(e.name)}><Trash2 className="h-4 w-4" /></Button>
            </td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```tsx
// BackupRunPanel.tsx
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
export function BackupRunPanel({ lines, running }: { lines: string[]; running: boolean }) {
  const { t } = useTranslation();
  if (!running && lines.length === 0) return null;
  return (
    <div className="rounded-md border bg-black/40 p-3 font-mono text-xs">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">{running && <Loader2 className="h-3 w-3 animate-spin" />}{running ? t('backups.running') : t('backups.finished')}</div>
      {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
    </div>
  );
}
```

```tsx
// pages/Backups.tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import { backupsApi } from '@/api/backups.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { BackupTable } from '@/components/backups/BackupTable';
import { BackupRunPanel } from '@/components/backups/BackupRunPanel';
import { formatBytes } from '@/lib/utils';

export default function Backups() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['backups'], queryFn: backupsApi.list });
  const { backupOutput, backupRunning, startBackupOutput } = useServerStore();
  const [toDelete, setToDelete] = useState<string | null>(null);
  const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('shared.error');

  const run = useMutation({ mutationFn: backupsApi.run, onMutate: startBackupOutput, onError: (e) => toast.error(errMsg(e)) });
  const del = useMutation({ mutationFn: backupsApi.remove, onSuccess: () => { toast.success(t('backups.deleted')); void qc.invalidateQueries({ queryKey: ['backups'] }); }, onError: (e) => toast.error(errMsg(e)) });
  const running = backupRunning || data?.running === true;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('backups.title')}</h1>
        {data && <span className="text-sm text-muted-foreground">{t('backups.total', { count: data.entries.length, size: formatBytes(data.totalBytes) })}</span>}
        {isAdmin && <Button className="ml-auto" size="sm" disabled={running || run.isPending} onClick={() => run.mutate()}><Archive className="mr-1 h-4 w-4" />{t('backups.runNow')}</Button>}
      </div>
      <BackupRunPanel lines={backupOutput} running={running} />
      <Card><CardContent className="p-4">
        {data && data.entries.length === 0 ? <EmptyState title={t('backups.empty')} /> :
          <BackupTable entries={data?.entries ?? []} isAdmin={isAdmin} onDownload={(n) => void backupsApi.download(n).catch((e) => toast.error(errMsg(e)))} onDelete={setToDelete} />}
      </CardContent></Card>
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} title={t('backups.confirmDelete.title')} description={t('backups.confirmDelete.description', { name: toDelete })} destructive loading={del.isPending} onConfirm={() => { if (toDelete) del.mutate(toDelete); setToDelete(null); }} />
    </div>
  );
}
```

- [ ] **Step 5 : fragment i18n `backups.json`**

Clés EN/FR : `title` (Backups / Sauvegardes), `name` (Name / Nom), `date` (Date), `size` (Size / Taille), `total` ("{{count}} archives, {{size}}"), `runNow` (Backup now / Sauvegarder maintenant), `running` (Backup in progress… / Sauvegarde en cours…), `finished` (Finished / Terminé), `deleted` (Backup deleted / Sauvegarde supprimée), `empty` (No backup yet / Aucune sauvegarde), `confirmDelete.title` (Delete this backup? / Supprimer cette sauvegarde ?), `confirmDelete.description` ("{{name}} will be permanently deleted." / "{{name}} sera supprimée définitivement."). Lancer `i18n:merge`.

- [ ] **Step 6 : tests, build, commit**

```bash
pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck && pnpm --filter @mc/frontend run build
git add -A && git commit -m "feat(frontend): page de gestion des sauvegardes"
```

---

### Task 16 : journal d'audit (route et page)

**Files:**
- Create: `packages/backend/src/routes/audit.routes.ts`, `packages/frontend/src/api/audit.api.ts`
- Modify: `packages/backend/src/app.ts`, `src/routes/users.routes.ts` (audit des actions utilisateurs), `packages/frontend/src/pages/Audit.tsx`, fragment i18n `audit.json`
- Test: `packages/backend/src/routes/audit.routes.test.ts`

**Interfaces:**
- Produces: `GET /api/audit?page=1&pageSize=50&action=&user=` → `AuditPage`.

- [ ] **Step 1 : test de la route**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { testPrisma } from '../test-db.js';
import { auditRoutes } from './audit.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
const app = express();
app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'v', role: 'viewer' }; next(); });
app.locals.prisma = prisma;
app.use('/api/audit', auditRoutes);
app.use(errorHandler);

beforeAll(async () => {
  await prisma.auditLog.createMany({ data: [
    { userId: 1, username: 'alice', action: 'server.start' },
    { userId: 2, username: 'bob', action: 'rcon.command', detail: 'list' },
    { userId: 1, username: 'alice', action: 'backup.delete', detail: 'x.tgz' },
  ] });
});

it('pages newest first', async () => {
  const r = await request(app).get('/api/audit?page=1&pageSize=2');
  expect(r.body.total).toBe(3); expect(r.body.entries).toHaveLength(2); expect(r.body.entries[0].action).toBe('backup.delete');
});
it('filters by action prefix and user', async () => {
  expect((await request(app).get('/api/audit?action=rcon')).body.entries).toHaveLength(1);
  expect((await request(app).get('/api/audit?user=alice')).body.entries).toHaveLength(2);
});
it('rejects a bad page size', async () => { expect((await request(app).get('/api/audit?pageSize=1000')).status).toBe(400); });
```

- [ ] **Step 2 : implémenter `audit.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../middleware/error-handler.js';
export const auditRoutes: Router = Router();
auditRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize ?? '50'), 10);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new AppError(400, 'Invalid pagination');
    const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : undefined;
    const user = typeof req.query.user === 'string' && req.query.user ? req.query.user : undefined;
    const where = { ...(action ? { action: { startsWith: action } } : {}), ...(user ? { username: { contains: user } } : {}) };
    const prisma = req.app.locals.prisma;
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ total, page, pageSize, entries: rows.map((r: { at: Date }) => ({ ...r, at: r.at.toISOString() })) });
  } catch (err) { next(err); }
});
```

Monter `app.use('/api/audit', auditRoutes)`. Dans `users.routes.ts`, ajouter `await audit(req, 'user.create', username)`, `'user.update'` avec `String(id)` et `'user.delete'` avec `String(id)` avant chaque réponse.

- [ ] **Step 3 : `audit.api.ts` et page `Audit.tsx`**

```ts
import api from './client';
import type { AuditPage } from '@mc/common';
export const auditApi = { list: (p: { page: number; pageSize: number; action?: string; user?: string }): Promise<AuditPage> => api.get('/audit', { params: p }).then((r) => r.data) };
```

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { auditApi } from '@/api/audit.api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ACTIONS = ['', 'server', 'rcon', 'backup', 'user'];

export default function Audit() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [user, setUser] = useState('');
  const pageSize = 50;
  const { data } = useQuery({ queryKey: ['audit', page, action, user], queryFn: () => auditApi.list({ page, pageSize, action: action || undefined, user: user || undefined }) });
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t('audit.title')}</h1>
        <div className="ml-auto flex gap-2">
          <Select value={action || 'all'} onValueChange={(v) => { setAction(v === 'all' ? '' : v); setPage(1); }}>
            <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{ACTIONS.map((a) => <SelectItem key={a || 'all'} value={a || 'all'}>{t(`audit.actions.${a || 'all'}`)}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="h-8 w-40" placeholder={t('audit.user')} value={user} onChange={(e) => { setUser(e.target.value); setPage(1); }} />
        </div>
      </div>
      <Card><CardContent className="p-4">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('audit.when')}</th><th>{t('audit.who')}</th><th>{t('audit.action')}</th><th>{t('audit.detail')}</th><th>IP</th></tr></thead>
          <tbody>{(data?.entries ?? []).map((e) => (
            <tr key={e.id} className="border-t"><td className="py-2">{new Date(e.at).toLocaleString(i18n.language)}</td><td>{e.username}</td><td className="font-mono text-xs">{e.action}</td><td className="font-mono text-xs">{e.detail}</td><td className="text-xs text-muted-foreground">{e.ip}</td></tr>
          ))}</tbody>
        </table>
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
          <span>{page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
        </div>
      </CardContent></Card>
    </div>
  );
}
```

Fragment i18n `audit.json` : `title` (Audit log / Journal d'audit), `when` (When / Quand), `who` (Who / Qui), `action` (Action), `detail` (Detail / Détail), `user` (User / Utilisateur), `actions.all` (All / Toutes), `actions.server` (Server / Serveur), `actions.rcon` (RCON), `actions.backup` (Backups / Sauvegardes), `actions.user` (Users / Utilisateurs).

- [ ] **Step 4 : tests, typecheck, commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add -A && git commit -m "feat: journal d'audit consultable"
```

---

### Task 17 : Dockerfiles, compose, README

**Files:**
- Create: `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml`, `docker-compose.example.yml`, `README.md`, `README.fr.md`, `CLAUDE.md`

- [ ] **Step 1 : `Dockerfile.backend`**

Copier `../ts6-manager/Dockerfile.backend` et :
- retirer ffmpeg, python3, python3-venv, le venv yt-dlp, `ENV PATH=…`, le stage `build-essential`, `ENV SIDECAR_URL`, `.config/yt-dlp` ;
- `@ts6/` → `@mc/` ;
- `RUN mkdir -p data && chown -R node:node data` ;
- `CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]`.

Le conteneur tourne en utilisateur `node` : pour lire le socket Docker, `docker-compose.yml` passe `group_add: ["${DOCKER_GID:-999}"]` et `.env.example` documente `DOCKER_GID=$(stat -c %g /var/run/docker.sock)`.

- [ ] **Step 2 : `Dockerfile.frontend`**

Copier `../ts6-manager/Dockerfile.frontend`, `@ts6/` → `@mc/`, retirer le bloc `location /widget/`, `client_max_body_size 150m` → `10m`, `proxy_read_timeout 600s` → `60s` sur `/api` sauf ajouter un bloc dédié :

```
    location /api/backups/ {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
```

placé avant `location /api`.

- [ ] **Step 3 : `docker-compose.yml`**

```yaml
services:
  backend:
    build: { context: ., dockerfile: Dockerfile.backend }
    container_name: mc-manager-backend
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DATABASE_URL=file:/app/packages/backend/data/mc-manager.db
      - "JWT_SECRET=${JWT_SECRET:?set JWT_SECRET in .env - openssl rand -hex 32}"
      - "ENCRYPTION_KEY=${ENCRYPTION_KEY:?set ENCRYPTION_KEY in .env, different from JWT_SECRET}"
      - FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}
      - MC_CONTAINER=${MC_CONTAINER:-mc}
      - MC_BACKUP_CONTAINER=${MC_BACKUP_CONTAINER:-mc-backup}
      - MC_DATA_DIR=/mc/data
      - MC_BACKUPS_DIR=/mc/backups
      - MC_RCON_PORT=${MC_RCON_PORT:-25575}
    group_add:
      - "${DOCKER_GID:-999}"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - backend-data:/app/packages/backend/data
      - ${MC_DATA_VOLUME:?set MC_DATA_VOLUME to the minecraft data volume name or path}:/mc/data:ro
      - ${MC_BACKUPS_VOLUME:?set MC_BACKUPS_VOLUME to the backups volume name or path}:/mc/backups
    networks: [mc-network]
  frontend:
    build: { context: ., dockerfile: Dockerfile.frontend }
    container_name: mc-manager-frontend
    restart: unless-stopped
    ports: ["${FRONTEND_PORT:-3000}:8080"]
    depends_on: [backend]
    networks: [mc-network]
volumes:
  backend-data:
networks:
  mc-network:
    external: true
    name: ${MC_NETWORK:-mc-network}
```

Ajouter à `.env.example` : `MC_DATA_VOLUME=mc-data`, `MC_BACKUPS_VOLUME=mc-backups`, `MC_NETWORK=mc-network`, `DOCKER_GID=999`.

- [ ] **Step 4 : `docker-compose.example.yml`** (stack complète de référence)

```yaml
services:
  mc:
    image: itzg/minecraft-server:latest
    container_name: mc
    tty: true
    stdin_open: true
    restart: unless-stopped
    ports: ["25565:25565"]
    environment:
      EULA: "TRUE"
      TYPE: "PAPER"
      MEMORY: "4G"
      ENABLE_RCON: "true"
      RCON_PASSWORD: "change-me"
    volumes: ["mc-data:/data"]
    networks: [mc-network]
  mc-backup:
    image: itzg/mc-backup:latest
    container_name: mc-backup
    restart: unless-stopped
    depends_on: { mc: { condition: service_healthy } }
    environment:
      BACKUP_METHOD: tar
      BACKUP_INTERVAL: "2h"
      PRUNE_BACKUPS_DAYS: "7"
      RCON_HOST: mc
      RCON_PASSWORD: "change-me"
      INITIAL_DELAY: "2m"
    volumes: ["mc-data:/data:ro", "mc-backups:/backups"]
    networks: [mc-network]
volumes:
  mc-data:
  mc-backups:
networks:
  mc-network:
    name: mc-network
```

- [ ] **Step 5 : README et CLAUDE.md**

`README.md` (EN) et `README.fr.md` : présentation, captures à venir, prérequis, déploiement (`cp .env.example .env`, secrets, `MC_DATA_VOLUME`, `MC_BACKUPS_VOLUME`, `DOCKER_GID`, `docker compose up -d --build`), avertissement sur le socket Docker, développement local (`pnpm install`, `pnpm db:generate`, `pnpm --filter @mc/common run build`, `pnpm dev`), rôles. `CLAUDE.md` : résumé de l'architecture (services dans `app.locals`, états du serveur, interfaces `DockerLike`/`RconLike`, invariants de sécurité, commandes).

- [ ] **Step 6 : build des images et test de bout en bout**

```bash
docker compose -f docker-compose.example.yml up -d
docker compose up -d --build
```

Ouvrir `http://localhost:3000`, créer l'admin, vérifier : état `starting` puis `ready`, logs en direct, `list` dans la console, tuiles remplies après 15 s, backup manuel avec sortie en direct puis archive listée, téléchargement, suppression, lignes d'audit, compte `viewer` sans boutons.

- [ ] **Step 7 : commit**

```bash
git add -A && git commit -m "feat: déploiement Docker, compose d'exemple et documentation"
```
