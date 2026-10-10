# MC Manager Lot 2a « Joueurs » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Journal de connexions Minecraft et MC Manager avec géolocalisation, gestion des joueurs (kick, ban, op, whitelist), fiches joueurs avec statistiques vanilla.

**Architecture:** Un service `PlayerJournal` consomme les lignes déjà parsées par le `LogStreamer` du lot 1 pour ouvrir et fermer des `PlayerSession`, réconciliées par le `list` RCON du collecteur. Un service `PlayerAdmin` envoie les commandes RCON et interprète les réponses. Les listes (whitelist, ops, bans) et les stats sont lues en lecture seule dans `/data`. Le frontend ajoute deux pages (Joueurs, Journal) et une fiche, rafraîchies par deux nouveaux messages WebSocket.

**Tech Stack:** Node 22, Express 4, Prisma 6 + SQLite, `geoip-lite` (base hors ligne), vitest + supertest ; React 18, TanStack Query 5, i18next, recharts.

**Spec:** `docs/superpowers/specs/2026-10-10-mc-manager-lot2a-joueurs-design.md`

## Global Constraints

- Le volume `/data` reste monté en lecture seule : aucune écriture dans `config.mc.dataDir`, jamais.
- Toute route d'action ou de journal est en `requireRole('admin')` (403 pour `viewer`). Les viewers ne reçoivent jamais d'IP, ni par les routes ni par le WebSocket.
- Noms de joueurs : `^[A-Za-z0-9_]{3,16}$`. IP : `net.isIP(ip) !== 0`. Raisons : 1 à 100 caractères, sans `\r` ni `\n`. Rien d'autre n'atteint une commande RCON.
- Audit (`audit(req, action, detail)`) écrit **avant** l'envoi RCON, comme au lot 1.
- Géolocalisation : `geoip-lite`, pays ISO seulement, aucun appel réseau.
- Rétention : `AppSetting` clé `journal.retentionDays`, défaut `90`, `0` = illimité, bornes 0 à 3650.
- Pagination des routes de journal : `page` ≥ 1, `limit` 1 à 100 (défaut 50), réponse `{ items, total, page, limit }`.
- i18n : jamais éditer `fr.json`/`en.json` à la main ; écrire un fragment dans `packages/frontend/scripts/i18n-fragments/` puis `node packages/frontend/scripts/merge-i18n.mjs`.
- Pas de `refetchInterval` : les données poussées par WebSocket sont invalidées à la réception des messages.
- Fichiers sources en CRLF dans ce dépôt sous Windows : utiliser l'outil d'édition, pas `sed` multi-lignes.
- Avant tout typecheck après la tâche 1 : `pnpm db:generate` puis `pnpm --filter @mc/common run build`.
- Chaque tâche se termine par `pnpm typecheck`, les tests du package touché, et un commit.

## Review Focus

1. Ligne de chat `<Alice> Bob left the game` : doit être ignorée, pas prise pour une sortie de Bob (test en tâche 2).
2. Redémarrage du backend pendant qu'un joueur est connecté : la session orpheline doit être fermée au démarrage et une nouvelle session `reconciled` ouverte au premier `list` (tests en tâche 4).
3. `ban-ip` avec une IP venue de l'utilisateur : une valeur comme `1.2.3.4 reason` ou `::1\nsay hi` doit être refusée en 400 avant tout envoi RCON (test en tâche 6).
4. Fichier `banned-players.json` corrompu : la page Joueurs doit rester utilisable avec une liste vide et un `warn` dans les logs (test en tâche 3).
5. Viewer appelant `GET /api/players/:uuid` : la fiche ne doit contenir ni `ip` ni `country` dans les sessions (test en tâche 7).

---

## File Structure

**Backend (`packages/backend/src/`)**

| Fichier | Responsabilité |
|---|---|
| `utils/geo.ts` | `normalizeIp`, `isPrivateIp`, `lookupCountry` (geoip-lite) |
| `utils/pagination.ts` | `parsePage(query)` → `{ page, limit, skip }` |
| `players/parse-player-line.ts` | `parsePlayerLine(message)` pur |
| `players/data-files.ts` | lecture `whitelist.json`, `ops.json`, `banned-*.json`, `usercache.json`, stats vanilla |
| `players/player-journal.ts` | `PlayerJournal` : sessions, réconciliation, fermetures, purge |
| `players/retention.ts` | `loadRetentionDays`, `saveRetentionDays` |
| `players/player-admin.ts` | `PlayerAdmin` : commandes RCON et interprétation |
| `players/player-sheet.ts` | `buildPlayerSheet(prisma, dataDir, uuid, withIp)` |
| `auth/web-login-journal.ts` | `recordWebLogin` fire-and-forget |
| `routes/players.routes.ts` | `playersRoutes`, `bansRoutes`, `listsRoutes`, `whitelistRoutes` |
| `routes/journal.routes.ts` | `journalRoutes` |
| `metrics/collector.ts` | ajout de `onPlayers` |
| `index.ts` | câblage |

**Common (`packages/common/src/`)** : `types/players.ts`, `types/journal.ts`, ajouts à `types/audit.ts` et `ws-messages.ts`.

**Frontend (`packages/frontend/src/`)**

| Fichier | Responsabilité |
|---|---|
| `api/players.api.ts`, `api/journal.api.ts` | clients HTTP |
| `lib/country.ts` | `flagEmoji`, `countryName` |
| `components/players/CountryFlag.tsx` | drapeau + chip LAN |
| `components/players/ReasonDialog.tsx` | confirmation avec raison optionnelle |
| `components/players/PlayerActionsMenu.tsx` | menu kick / ban / ban IP / op / deop |
| `components/players/OnlineTab.tsx`, `AllPlayersTab.tsx`, `WhitelistTab.tsx`, `BansTab.tsx` | onglets |
| `pages/Players.tsx`, `pages/PlayerSheet.tsx`, `pages/Journal.tsx` | pages |
| `components/settings/JournalRetentionCard.tsx` | réglage de rétention |

---

### Task 1: Types partagés, schéma Prisma, géolocalisation

**Files:**
- Create: `packages/common/src/types/players.ts`, `packages/common/src/types/journal.ts`
- Modify: `packages/common/src/index.ts`, `packages/common/src/types/audit.ts`, `packages/common/src/ws-messages.ts`
- Modify: `packages/backend/prisma/schema.prisma`, `packages/backend/package.json`
- Create: `packages/backend/src/utils/geo.ts`
- Test: `packages/backend/src/utils/geo.test.ts`

**Interfaces:**
- Produces: tous les types ci-dessous, `lookupCountry(ip): { country: string | null; isPrivate: boolean }`, `normalizeIp(raw): string`, modèles Prisma `playerSession`, `playerLoginFailure`, `webLogin`.

- [ ] **Step 1: Types joueurs dans common**

Créer `packages/common/src/types/players.ts` :

```ts
export interface OnlinePlayer { name: string; uuid: string | null; joinedAt: string; country: string | null; hasIp: boolean }
export type SessionSource = 'log' | 'reconciled';
export interface PlayerSessionEntry {
  id: number; uuid: string | null; name: string; source: SessionSource;
  joinedAt: string; leftAt: string | null;
  /** Absents pour un viewer. */
  ip?: string | null; country?: string | null;
}
export interface PlayerSummary {
  uuid: string | null; name: string; online: boolean; lastSeenAt: string; sessionCount: number;
  op: boolean; whitelisted: boolean; banned: boolean;
}
export interface VanillaStats {
  playTimeSeconds: number | null; deaths: number | null; playerKills: number | null; mobKills: number | null;
  distanceMeters: number | null; jumps: number | null; damageTaken: number | null; blocksMined: number | null; itemsCrafted: number | null;
}
export interface PlayerSheet {
  uuid: string; name: string; previousNames: string[]; online: boolean; op: boolean; whitelisted: boolean; banned: boolean;
  lastSeenAt: string | null; sessionCount: number; playTimeObservedSeconds: number;
  sessions: PlayerSessionEntry[];
  /** 30 derniers jours, `day` au format YYYY-MM-DD (UTC). */
  daily: { day: string; minutes: number }[];
  stats: VanillaStats | null;
}
export interface WhitelistEntry { uuid: string; name: string }
export interface OpEntry { uuid: string; name: string; level: number; bypassesPlayerLimit: boolean }
export interface BannedPlayer { uuid: string; name: string; created: string; source: string; expires: string; reason: string }
export interface BannedIp { ip: string; created: string; source: string; expires: string; reason: string }
export interface ServerLists { whitelist: WhitelistEntry[]; ops: OpEntry[]; bannedPlayers: BannedPlayer[]; bannedIps: BannedIp[]; whitelistEnabled: boolean }
```

Créer `packages/common/src/types/journal.ts` :

```ts
export interface Page<T> { items: T[]; total: number; page: number; limit: number }
export type LoginFailureReason = 'not_whitelisted' | 'banned' | 'full' | 'other';
export interface PlayerLoginFailureEntry { id: number; name: string; ip: string | null; country: string | null; reason: LoginFailureReason; message: string; createdAt: string }
export type WebLoginReason = 'bad_password' | 'disabled' | 'mfa_failed' | 'unknown_user' | 'trusted_device' | 'mfa';
export interface WebLoginEntry { id: number; username: string; userId: number | null; ip: string; country: string | null; success: boolean; reason: WebLoginReason | null; createdAt: string }
export interface JournalRetention { days: number }
```

Dans `packages/common/src/index.ts`, ajouter :

```ts
export * from './types/players.js';
export * from './types/journal.js';
```

Dans `packages/common/src/types/audit.ts`, remplacer le type `AuditAction` par :

```ts
export type AuditAction =
  | 'server.start' | 'server.stop' | 'server.restart' | 'rcon.command'
  | 'backup.run' | 'backup.delete' | 'backup.download'
  | 'user.create' | 'user.update' | 'user.delete'
  | 'player.kick' | 'player.ban' | 'player.ban_ip' | 'player.pardon' | 'player.pardon_ip' | 'player.op' | 'player.deop'
  | 'whitelist.add' | 'whitelist.remove' | 'whitelist.toggle'
  | 'journal.retention';
```

Dans `packages/common/src/ws-messages.ts`, ajouter l'import et deux membres à l'union :

```ts
import type { ServerInfo } from './types/server.js';
import type { OnlinePlayer } from './types/players.js';
export interface LogLine { ts: string | null; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'RAW'; thread: string | null; message: string; raw: string }
export type WsMessage =
  | { type: 'server.status'; info: ServerInfo }
  | { type: 'log.line'; line: LogLine }
  | { type: 'log.history'; lines: LogLine[] }
  | { type: 'metrics.tick'; info: ServerInfo }
  | { type: 'backup.progress'; line: string }
  | { type: 'backup.done'; exitCode: number }
  | { type: 'backup.list.changed' }
  | { type: 'player.session'; kind: 'join' | 'leave'; player: OnlinePlayer; leftAt?: string }
  | { type: 'player.lists.changed' };
```

- [ ] **Step 2: Schéma Prisma**

Ajouter à la fin de `packages/backend/prisma/schema.prisma` :

```prisma
model PlayerSession {
  id       Int       @id @default(autoincrement())
  uuid     String?
  name     String
  ip       String?
  country  String?
  source   String
  joinedAt DateTime
  leftAt   DateTime?

  @@index([joinedAt])
  @@index([uuid, joinedAt])
  @@index([name])
}

model PlayerLoginFailure {
  id        Int      @id @default(autoincrement())
  name      String
  ip        String?
  country   String?
  reason    String
  message   String
  createdAt DateTime @default(now())

  @@index([createdAt])
}

model WebLogin {
  id        Int      @id @default(autoincrement())
  username  String
  userId    Int?
  ip        String
  country   String?
  success   Boolean
  reason    String?
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([username, createdAt])
}
```

- [ ] **Step 3: Dépendance geoip-lite et régénération**

```bash
pnpm --filter @mc/backend add geoip-lite@^2.0.2
pnpm --filter @mc/backend add -D @types/geoip-lite@^1.4.4
pnpm db:generate
pnpm --filter @mc/common run build
```

- [ ] **Step 4: Test de géolocalisation (échec attendu)**

Créer `packages/backend/src/utils/geo.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { normalizeIp, isPrivateIp, lookupCountry } from './geo.js';

describe('normalizeIp', () => {
  it.each([
    ['1.2.3.4:51234', '1.2.3.4'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['::ffff:1.2.3.4:51234', '1.2.3.4'],
    ['[2001:db8::1]:51234', '2001:db8::1'],
    ['0:0:0:0:0:0:0:1:51234', '0:0:0:0:0:0:0:1'],
    ['2001:db8::1', '2001:db8::1'],
    ['  10.0.0.5 ', '10.0.0.5'],
    ['', ''],
  ])('%s -> %s', (raw, expected) => expect(normalizeIp(raw)).toBe(expected));
});

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '::1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', 'fd12::1', 'fe80::1'])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '2001:db8::1'])('%s is public', (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe('lookupCountry', () => {
  it('resolves a public IPv4 to an ISO code', () => {
    const r = lookupCountry('8.8.8.8:1234');
    expect(r.isPrivate).toBe(false);
    expect(r.country).toMatch(/^[A-Z]{2}$/);
  });
  it('flags private ranges without a country', () => {
    expect(lookupCountry('192.168.0.10:25565')).toEqual({ country: null, isPrivate: true });
  });
  it('returns null for an empty or invalid input', () => {
    expect(lookupCountry('')).toEqual({ country: null, isPrivate: false });
    expect(lookupCountry('not-an-ip')).toEqual({ country: null, isPrivate: false });
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/utils/geo.test.ts`
Expected: FAIL (module `./geo.js` introuvable).

- [ ] **Step 5: Implémentation de geo.ts**

Créer `packages/backend/src/utils/geo.ts` :

```ts
import { isIP } from 'net';
import geoip from 'geoip-lite';

export interface GeoResult {
  country: string | null; // ISO 3166-1 alpha-2
  isPrivate: boolean;
}

/**
 * Ramène une adresse telle que Minecraft ou Express la donnent à une IP nue :
 * `[2001:db8::1]:51234`, `1.2.3.4:51234`, `0:0:0:0:0:0:0:1:51234`, `::ffff:1.2.3.4`.
 */
export function normalizeIp(raw: string): string {
  let ip = (raw || '').trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) ip = bracket[1];
  else if (!isIP(ip)) {
    // Un suffixe :port sur une IPv4 ou une IPv6 en forme longue (le reste doit rester une IP valide).
    const i = ip.lastIndexOf(':');
    if (i > 0 && isIP(ip.slice(0, i))) ip = ip.slice(0, i);
  }
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (isIP(v4) === 4) ip = v4;
  }
  return ip;
}

export function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(ip)) return true;
  if (/^fe80:/i.test(ip)) return true;
  return false;
}

export function lookupCountry(rawIp: string): GeoResult {
  const ip = normalizeIp(rawIp);
  if (!ip || !isIP(ip)) return { country: null, isPrivate: false };
  if (isPrivateIp(ip)) return { country: null, isPrivate: true };
  try {
    const geo = geoip.lookup(ip);
    return { country: geo?.country || null, isPrivate: false };
  } catch {
    return { country: null, isPrivate: false };
  }
}
```

- [ ] **Step 6: Vérifier**

Run: `pnpm --filter @mc/backend exec vitest run src/utils/geo.test.ts`
Expected: PASS (12 + 12 + 3 tests).

Run: `pnpm typecheck`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add packages/common/src packages/backend/prisma/schema.prisma packages/backend/package.json pnpm-lock.yaml packages/backend/src/utils/geo.ts packages/backend/src/utils/geo.test.ts
git commit -m "feat(lot2a): types joueurs et journal, schéma Prisma, géolocalisation hors ligne"
```

---

### Task 2: Parseur des lignes joueurs

**Files:**
- Create: `packages/backend/src/players/parse-player-line.ts`
- Test: `packages/backend/src/players/parse-player-line.test.ts`

**Interfaces:**
- Consumes: `normalizeIp` (tâche 1).
- Produces: `type PlayerEvent`, `parsePlayerLine(message: string): PlayerEvent | null`, `classifyRefusal(message: string): LoginFailureReason`.

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/backend/src/players/parse-player-line.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { parsePlayerLine, classifyRefusal } from './parse-player-line.js';

describe('parsePlayerLine', () => {
  it('reads the UUID announcement', () => {
    expect(parsePlayerLine('UUID of player Alice_01 is 069a79f4-44e9-4726-a5be-fca90e38aaf5'))
      .toEqual({ type: 'uuid', name: 'Alice_01', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5' });
  });
  it('reads a join with an IPv4 and strips the port', () => {
    expect(parsePlayerLine('Alice_01[/203.0.113.9:51234] logged in with entity id 123 at (12.5, 64.0, -8.2)'))
      .toEqual({ type: 'join', name: 'Alice_01', ip: '203.0.113.9' });
  });
  it('reads a join with a long-form IPv6', () => {
    expect(parsePlayerLine('Bob[/0:0:0:0:0:0:0:1:51234] logged in with entity id 5 at (0.0, 64.0, 0.0)'))
      .toEqual({ type: 'join', name: 'Bob', ip: '0:0:0:0:0:0:0:1' });
  });
  it('reads a join with a bracketed IPv6', () => {
    expect(parsePlayerLine('Bob[/[2001:db8::1]:51234] logged in with entity id 5 at (0.0, 64.0, 0.0)'))
      .toEqual({ type: 'join', name: 'Bob', ip: '2001:db8::1' });
  });
  it('reads a leave', () => {
    expect(parsePlayerLine('Alice_01 left the game')).toEqual({ type: 'leave', name: 'Alice_01' });
  });
  it('reads lost connection as a leave', () => {
    expect(parsePlayerLine('Alice_01 lost connection: Disconnected')).toEqual({ type: 'leave', name: 'Alice_01' });
  });
  it('reads a refusal in the modern format', () => {
    expect(parsePlayerLine('Disconnecting Mallory (/198.51.100.7:40000): You are not white-listed on this server!'))
      .toEqual({ type: 'refused', name: 'Mallory', ip: '198.51.100.7', message: 'You are not white-listed on this server!' });
  });
  it('reads a refusal in the GameProfile format', () => {
    expect(parsePlayerLine('Disconnecting com.mojang.authlib.GameProfile@1a2b[id=069a79f4-44e9-4726-a5be-fca90e38aaf5,name=Mallory,properties={},legacy=false] (/198.51.100.7:40000): You are banned from this server.'))
      .toEqual({ type: 'refused', name: 'Mallory', ip: '198.51.100.7', message: 'You are banned from this server.' });
  });
  it('ignores chat lines that look like events', () => {
    expect(parsePlayerLine('<Alice_01> Bob left the game')).toBeNull();
    expect(parsePlayerLine('<Alice_01> UUID of player Bob is 069a79f4-44e9-4726-a5be-fca90e38aaf5')).toBeNull();
  });
  it('ignores unrelated lines and invalid names', () => {
    expect(parsePlayerLine('Done (3.2s)! For help, type "help"')).toBeNull();
    expect(parsePlayerLine('Al left the game')).toBeNull();
    expect(parsePlayerLine('a-b[/1.2.3.4:1] logged in with entity id 1 at (0, 0, 0)')).toBeNull();
  });
});

describe('classifyRefusal', () => {
  it.each([
    ['You are not white-listed on this server!', 'not_whitelisted'],
    ['You are banned from this server.', 'banned'],
    ['The server is full!', 'full'],
    ['Failed to verify username!', 'other'],
  ])('%s -> %s', (m, r) => expect(classifyRefusal(m)).toBe(r));
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/players/parse-player-line.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémentation**

Créer `packages/backend/src/players/parse-player-line.ts` :

```ts
import type { LoginFailureReason } from '@mc/common';
import { normalizeIp } from '../utils/geo.js';

export type PlayerEvent =
  | { type: 'uuid'; name: string; uuid: string }
  | { type: 'join'; name: string; ip: string }
  | { type: 'leave'; name: string }
  | { type: 'refused'; name: string; ip: string | null; message: string };

const NAME = '([A-Za-z0-9_]{3,16})';
const RE_UUID = new RegExp(`^UUID of player ${NAME} is ([0-9a-fA-F-]{36})$`);
const RE_JOIN = new RegExp(`^${NAME}\\[/(.+?)\\] logged in with entity id \\d+`);
const RE_LEAVE = new RegExp(`^${NAME} left the game$`);
const RE_LOST = new RegExp(`^${NAME} lost connection: `);
const RE_REFUSED = new RegExp(`^Disconnecting ${NAME} \\(/(.+?)\\): (.*)$`);
const RE_REFUSED_PROFILE = /^Disconnecting com\.mojang\.authlib\.GameProfile@\S*?\[.*?name=([A-Za-z0-9_]{3,16}).*?\] \(\/(.+?)\): (.*)$/;

/** Applique au champ `message` d'une LogLine (niveau et thread déjà retirés). */
export function parsePlayerLine(message: string): PlayerEvent | null {
  // Un message de chat est encadré de <pseudo> : tout ce qu'il contient est du texte de joueur.
  if (message.startsWith('<')) return null;
  let m: RegExpExecArray | null;
  if ((m = RE_UUID.exec(message))) return { type: 'uuid', name: m[1], uuid: m[2].toLowerCase() };
  if ((m = RE_JOIN.exec(message))) return { type: 'join', name: m[1], ip: normalizeIp(m[2]) };
  if ((m = RE_LEAVE.exec(message)) || (m = RE_LOST.exec(message))) return { type: 'leave', name: m[1] };
  if ((m = RE_REFUSED.exec(message)) || (m = RE_REFUSED_PROFILE.exec(message))) {
    const ip = normalizeIp(m[2]);
    return { type: 'refused', name: m[1], ip: ip || null, message: m[3].trim() };
  }
  return null;
}

export function classifyRefusal(message: string): LoginFailureReason {
  const s = message.toLowerCase();
  if (s.includes('white-list') || s.includes('whitelist')) return 'not_whitelisted';
  if (s.includes('banned')) return 'banned';
  if (s.includes('full')) return 'full';
  return 'other';
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/players/parse-player-line.test.ts`
Expected: PASS.

```bash
git add packages/backend/src/players/parse-player-line.ts packages/backend/src/players/parse-player-line.test.ts
git commit -m "feat(lot2a): parseur des lignes de connexion, sortie et refus"
```

---

### Task 3: Lecture des fichiers de données et des stats vanilla

**Files:**
- Create: `packages/backend/src/players/data-files.ts`
- Test: `packages/backend/src/players/data-files.test.ts`

**Interfaces:**
- Consumes: `readServerProperties(dataDir)` (lot 1, `utils/server-properties.ts`), types `ServerLists`, `VanillaStats` (tâche 1).
- Produces:
  - `readJsonArray<T>(dataDir: string, file: string): Promise<T[]>`
  - `readLists(dataDir: string): Promise<ServerLists>`
  - `readUserCache(dataDir: string): Promise<{ name: string; uuid: string }[]>`
  - `parseVanillaStats(json: unknown): VanillaStats`
  - `readPlayerStats(dataDir: string, uuid: string): Promise<VanillaStats | null>`
  - `isUuid(s: string): boolean`

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/backend/src/players/data-files.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { readJsonArray, readLists, readUserCache, parseVanillaStats, readPlayerStats, isUuid } from './data-files.js';

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';

describe('data files', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'mc-data-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns an empty array for a missing file', async () => {
    expect(await readJsonArray(dir, 'whitelist.json')).toEqual([]);
  });
  it('returns an empty array for invalid JSON or a non-array', async () => {
    writeFileSync(path.join(dir, 'banned-players.json'), '{ not json');
    writeFileSync(path.join(dir, 'ops.json'), '{"a":1}');
    expect(await readJsonArray(dir, 'banned-players.json')).toEqual([]);
    expect(await readJsonArray(dir, 'ops.json')).toEqual([]);
  });
  it('reads the four lists and the whitelist flag', async () => {
    writeFileSync(path.join(dir, 'whitelist.json'), JSON.stringify([{ uuid: UUID, name: 'Alice' }]));
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ uuid: UUID, name: 'Alice', level: 4, bypassesPlayerLimit: false }]));
    writeFileSync(path.join(dir, 'banned-players.json'), JSON.stringify([{ uuid: 'x', name: 'Mallory', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: 'griefing' }]));
    writeFileSync(path.join(dir, 'banned-ips.json'), JSON.stringify([{ ip: '198.51.100.7', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: 'spam' }]));
    writeFileSync(path.join(dir, 'server.properties'), 'white-list=true\n');
    const lists = await readLists(dir);
    expect(lists.whitelist).toEqual([{ uuid: UUID, name: 'Alice' }]);
    expect(lists.ops[0]).toMatchObject({ name: 'Alice', level: 4 });
    expect(lists.bannedPlayers[0]).toMatchObject({ name: 'Mallory', reason: 'griefing' });
    expect(lists.bannedIps[0]).toMatchObject({ ip: '198.51.100.7' });
    expect(lists.whitelistEnabled).toBe(true);
  });
  it('whitelistEnabled is false without server.properties', async () => {
    expect((await readLists(dir)).whitelistEnabled).toBe(false);
  });
  it('drops malformed entries instead of failing', async () => {
    writeFileSync(path.join(dir, 'whitelist.json'), JSON.stringify([{ uuid: UUID, name: 'Alice' }, { name: 'NoUuid' }, 'junk', null]));
    expect((await readLists(dir)).whitelist).toEqual([{ uuid: UUID, name: 'Alice' }]);
  });
  it('reads the user cache', async () => {
    writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Alice', uuid: UUID, expiresOn: '2026-11-10 10:00:00 +0000' }]));
    expect(await readUserCache(dir)).toEqual([{ name: 'Alice', uuid: UUID }]);
  });
  it('reads a stats file from the level directory', async () => {
    mkdirSync(path.join(dir, 'world', 'stats'), { recursive: true });
    writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
    writeFileSync(path.join(dir, 'world', 'stats', `${UUID}.json`), JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_time': 72000, 'minecraft:deaths': 3 } }, DataVersion: 3953 }));
    expect(await readPlayerStats(dir, UUID)).toMatchObject({ playTimeSeconds: 3600, deaths: 3, mobKills: null });
    expect(await readPlayerStats(dir, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
  it('rejects a non-UUID before touching the filesystem', async () => {
    expect(isUuid('../../etc/passwd')).toBe(false);
    expect(await readPlayerStats(dir, '../server.properties')).toBeNull();
  });
});

describe('parseVanillaStats', () => {
  it('maps modern keys and sums mined/crafted', () => {
    const s = parseVanillaStats({ stats: {
      'minecraft:custom': { 'minecraft:play_time': 1200, 'minecraft:deaths': 2, 'minecraft:player_kills': 1, 'minecraft:mob_kills': 40, 'minecraft:walk_one_cm': 150000, 'minecraft:sprint_one_cm': 50000, 'minecraft:jump': 99, 'minecraft:damage_taken': 250 },
      'minecraft:mined': { 'minecraft:stone': 10, 'minecraft:dirt': 5 },
      'minecraft:crafted': { 'minecraft:stick': 4 },
    } });
    expect(s).toEqual({ playTimeSeconds: 60, deaths: 2, playerKills: 1, mobKills: 40, distanceMeters: 2000, jumps: 99, damageTaken: 25, blocksMined: 15, itemsCrafted: 4 });
  });
  it('falls back to play_one_minute and leaves missing keys null', () => {
    const s = parseVanillaStats({ stats: { 'minecraft:custom': { 'minecraft:play_one_minute': 2400 } } });
    expect(s.playTimeSeconds).toBe(120);
    expect(s.deaths).toBeNull();
    expect(s.distanceMeters).toBeNull();
    expect(s.blocksMined).toBeNull();
  });
  it('tolerates garbage', () => {
    expect(parseVanillaStats(null).playTimeSeconds).toBeNull();
    expect(parseVanillaStats({ stats: 'x' }).deaths).toBeNull();
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/players/data-files.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémentation**

Créer `packages/backend/src/players/data-files.ts` :

```ts
import { readFile } from 'fs/promises';
import path from 'path';
import type { BannedIp, BannedPlayer, OpEntry, ServerLists, VanillaStats, WhitelistEntry } from '@mc/common';
import { readServerProperties } from '../utils/server-properties.js';
import { logger } from '../utils/logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);

/** Tableau JSON lu dans /data ; fichier absent → [], JSON invalide ou non-tableau → [] + warn. */
export async function readJsonArray<T>(dataDir: string, file: string): Promise<T[]> {
  let text: string;
  try { text = await readFile(path.join(dataDir, file), 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file }, 'cannot read data file');
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) { logger.warn({ file }, 'data file is not a JSON array'); return []; }
    return parsed as T[];
  } catch (err) { logger.warn({ err, file }, 'data file is not valid JSON'); return []; }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

export async function readLists(dataDir: string): Promise<ServerLists> {
  const [wl, ops, bp, bi, props] = await Promise.all([
    readJsonArray<unknown>(dataDir, 'whitelist.json'),
    readJsonArray<unknown>(dataDir, 'ops.json'),
    readJsonArray<unknown>(dataDir, 'banned-players.json'),
    readJsonArray<unknown>(dataDir, 'banned-ips.json'),
    readServerProperties(dataDir).catch(() => ({} as Record<string, string>)),
  ]);
  const whitelist: WhitelistEntry[] = wl.filter(isObj).filter((e) => str(e.uuid) && str(e.name)).map((e) => ({ uuid: str(e.uuid), name: str(e.name) }));
  const opEntries: OpEntry[] = ops.filter(isObj).filter((e) => str(e.uuid) && str(e.name))
    .map((e) => ({ uuid: str(e.uuid), name: str(e.name), level: typeof e.level === 'number' ? e.level : 0, bypassesPlayerLimit: e.bypassesPlayerLimit === true }));
  const bannedPlayers: BannedPlayer[] = bp.filter(isObj).filter((e) => str(e.name))
    .map((e) => ({ uuid: str(e.uuid), name: str(e.name), created: str(e.created), source: str(e.source), expires: str(e.expires) || 'forever', reason: str(e.reason) }));
  const bannedIps: BannedIp[] = bi.filter(isObj).filter((e) => str(e.ip))
    .map((e) => ({ ip: str(e.ip), created: str(e.created), source: str(e.source), expires: str(e.expires) || 'forever', reason: str(e.reason) }));
  return { whitelist, ops: opEntries, bannedPlayers, bannedIps, whitelistEnabled: props['white-list'] === 'true' };
}

export async function readUserCache(dataDir: string): Promise<{ name: string; uuid: string }[]> {
  const rows = await readJsonArray<unknown>(dataDir, 'usercache.json');
  return rows.filter(isObj).filter((e) => str(e.name) && isUuid(str(e.uuid))).map((e) => ({ name: str(e.name), uuid: str(e.uuid).toLowerCase() }));
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const sumValues = (section: unknown): number | null => {
  if (!isObj(section)) return null;
  const vals = Object.values(section).map(num).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

export function parseVanillaStats(json: unknown): VanillaStats {
  const stats = isObj(json) && isObj(json.stats) ? json.stats : {};
  const custom = isObj(stats['minecraft:custom']) ? stats['minecraft:custom'] : {};
  const ticks = num(custom['minecraft:play_time']) ?? num(custom['minecraft:play_one_minute']);
  const cm = Object.entries(custom).filter(([k]) => k.endsWith('_one_cm')).map(([, v]) => num(v)).filter((v): v is number => v !== null);
  const damage = num(custom['minecraft:damage_taken']);
  return {
    playTimeSeconds: ticks === null ? null : Math.round(ticks / 20),
    deaths: num(custom['minecraft:deaths']),
    playerKills: num(custom['minecraft:player_kills']),
    mobKills: num(custom['minecraft:mob_kills']),
    distanceMeters: cm.length ? Math.round(cm.reduce((a, b) => a + b, 0) / 100) : null,
    jumps: num(custom['minecraft:jump']),
    damageTaken: damage === null ? null : Math.round(damage / 10),
    blocksMined: sumValues(stats['minecraft:mined']),
    itemsCrafted: sumValues(stats['minecraft:crafted']),
  };
}

/** `<level-name>/stats/<uuid>.json`, null si absent ; l'UUID est validé avant de former le chemin. */
export async function readPlayerStats(dataDir: string, uuid: string): Promise<VanillaStats | null> {
  if (!isUuid(uuid)) return null;
  const props = await readServerProperties(dataDir).catch(() => ({} as Record<string, string>));
  const level = props['level-name'] || 'world';
  const file = path.join(dataDir, level, 'stats', `${uuid.toLowerCase()}.json`);
  try { return parseVanillaStats(JSON.parse(await readFile(file, 'utf8'))); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file }, 'cannot read player stats');
    return null;
  }
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/players/data-files.test.ts`
Expected: PASS.

```bash
git add packages/backend/src/players/data-files.ts packages/backend/src/players/data-files.test.ts
git commit -m "feat(lot2a): lecture des listes du serveur, du cache des joueurs et des stats vanilla"
```

---

### Task 4: Service PlayerJournal et rétention

**Files:**
- Create: `packages/backend/src/players/retention.ts`
- Create: `packages/backend/src/players/player-journal.ts`
- Test: `packages/backend/src/players/player-journal.test.ts`

**Interfaces:**
- Consumes: `parsePlayerLine`, `classifyRefusal` (tâche 2), `readUserCache` (tâche 3), `lookupCountry` (tâche 1), `LogLine` et `OnlinePlayer` de `@mc/common`, `testPrisma()` (`src/test-db.ts`).
- Produces:
  - `loadRetentionDays(prisma): Promise<number>`, `saveRetentionDays(prisma, days): Promise<void>`, `DEFAULT_RETENTION_DAYS = 90`.
  - `class PlayerJournal extends EventEmitter` : `constructor(prisma, dataDir, now?: () => Date)`, `start()`, `online(): OnlinePlayer[]`, `currentIp(name: string): string | null` (IP de la session ouverte, pour le ban IP côté serveur), `handleLine(line: LogLine): Promise<void>`, `reconcile(names: string[]): Promise<void>`, `onStatus(status: ServerStatus): Promise<void>`, `closeAll(): Promise<void>`, `purge(): Promise<void>`. Événement `'session'` avec `{ kind: 'join' | 'leave'; player: OnlinePlayer; leftAt?: string }`.
  - `GRACE_MS = 30_000` : une session ouverte depuis moins de 30 s n'est pas fermée par un `list` qui ne la contient pas (réponse RCON antérieure à la ligne de log), et un joueur sorti depuis moins de 30 s n'est pas recréé par un `list` qui le contient encore.

- [ ] **Step 1: Rétention**

Créer `packages/backend/src/players/retention.ts` :

```ts
import type { PrismaClient } from '../../generated/prisma/index.js';

const KEY = 'journal.retentionDays';
export const DEFAULT_RETENTION_DAYS = 90;
export const MAX_RETENTION_DAYS = 3650;

/** Jours de rétention du journal ; 0 = illimité. Défaut 90 si absent ou invalide. */
export async function loadRetentionDays(prisma: PrismaClient): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    const n = row ? parseInt(row.value, 10) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= MAX_RETENTION_DAYS ? n : DEFAULT_RETENTION_DAYS;
  } catch { return DEFAULT_RETENTION_DAYS; }
}

export async function saveRetentionDays(prisma: PrismaClient, days: number): Promise<void> {
  const value = String(Math.max(0, Math.min(MAX_RETENTION_DAYS, Math.floor(days))));
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}
```

- [ ] **Step 2: Test du journal (échec attendu)**

Créer `packages/backend/src/players/player-journal.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { LogLine } from '@mc/common';
import { testPrisma } from '../test-db.js';
import { PlayerJournal, GRACE_MS } from './player-journal.js';
import { saveRetentionDays } from './retention.js';

const prisma = testPrisma();
const dir = mkdtempSync(path.join(tmpdir(), 'mc-journal-'));
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const L = (message: string): LogLine => ({ ts: '10:00:00', level: 'INFO', thread: 'Server thread', message, raw: message });
let t = Date.parse('2026-10-10T10:00:00Z');
const now = () => new Date(t);
const advance = (ms: number) => { t += ms; };

function journal() {
  const j = new PlayerJournal(prisma, dir, now);
  const events: unknown[] = [];
  j.on('session', (e) => events.push(e));
  return { j, events };
}

beforeEach(async () => {
  t = Date.parse('2026-10-10T10:00:00Z');
  await prisma.playerSession.deleteMany();
  await prisma.playerLoginFailure.deleteMany();
  await prisma.webLogin.deleteMany();
  await prisma.metricSample.deleteMany();
  await prisma.appSetting.deleteMany();
  rmSync(path.join(dir, 'usercache.json'), { force: true });
});

describe('PlayerJournal sessions', () => {
  it('opens a session on join with uuid, ip and country, closes it on leave', async () => {
    const { j, events } = journal();
    await j.handleLine(L(`UUID of player Alice is ${UUID}`));
    await j.handleLine(L('Alice[/8.8.8.8:51234] logged in with entity id 1 at (0, 64, 0)'));
    expect(j.online()).toEqual([{ name: 'Alice', uuid: UUID, joinedAt: now().toISOString(), country: expect.stringMatching(/^[A-Z]{2}$/), hasIp: true }]);
    advance(90_000);
    await j.handleLine(L('Alice left the game'));
    expect(j.online()).toEqual([]);
    const rows = await prisma.playerSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uuid: UUID, name: 'Alice', ip: '8.8.8.8', source: 'log' });
    expect(rows[0].leftAt?.getTime()).toBe(t);
    expect(events).toEqual([
      { kind: 'join', player: expect.objectContaining({ name: 'Alice' }) },
      { kind: 'leave', player: expect.objectContaining({ name: 'Alice' }), leftAt: now().toISOString() },
    ]);
  });

  it('stores no country for a LAN address and exposes the current ip server-side only', async () => {
    const { j } = journal();
    await j.handleLine(L('Bob[/192.168.1.20:51234] logged in with entity id 1 at (0, 64, 0)'));
    expect((await prisma.playerSession.findFirst())?.country).toBeNull();
    expect(j.online()[0]).toMatchObject({ country: null, hasIp: true });
    expect(JSON.stringify(j.online())).not.toContain('192.168');
    expect(j.currentIp('bob')).toBe('192.168.1.20');
    expect(j.currentIp('Nobody')).toBeNull();
  });

  it('a second join without leave closes the first session', async () => {
    const { j } = journal();
    await j.handleLine(L('Bob[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(1000);
    await j.handleLine(L('Bob[/8.8.8.8:2] logged in with entity id 2 at (0, 64, 0)'));
    const rows = await prisma.playerSession.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].leftAt).not.toBeNull();
    expect(rows[1].leftAt).toBeNull();
    expect(j.online()).toHaveLength(1);
  });

  it('ignores a leave without an open session and unrelated lines', async () => {
    const { j, events } = journal();
    await j.handleLine(L('Ghost left the game'));
    await j.handleLine(L('Done (3.2s)! For help, type "help"'));
    expect(await prisma.playerSession.count()).toBe(0);
    expect(events).toEqual([]);
  });

  it('records a refusal with its reason', async () => {
    const { j } = journal();
    await j.handleLine(L('Disconnecting Mallory (/198.51.100.7:40000): You are not white-listed on this server!'));
    const row = await prisma.playerLoginFailure.findFirst();
    expect(row).toMatchObject({ name: 'Mallory', ip: '198.51.100.7', reason: 'not_whitelisted', message: 'You are not white-listed on this server!' });
  });

  it('falls back to usercache.json for the uuid', async () => {
    writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Carol', uuid: UUID, expiresOn: 'x' }]));
    const { j } = journal();
    await j.handleLine(L('Carol[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    expect((await prisma.playerSession.findFirst())?.uuid).toBe(UUID);
  });

  it('closes everything when the server stops', async () => {
    const { j } = journal();
    await j.handleLine(L('Bob[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    await j.onStatus('ready');
    expect(j.online()).toHaveLength(1);
    await j.onStatus('stopping');
    expect(j.online()).toHaveLength(0);
    expect((await prisma.playerSession.findFirst())?.leftAt).not.toBeNull();
  });
});

describe('PlayerJournal reconcile', () => {
  it('creates reconciled sessions for unseen names and closes stale ones after the grace period', async () => {
    const { j, events } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(GRACE_MS + 1000);
    await j.reconcile(['Bob']);
    const rows = await prisma.playerSession.findMany({ orderBy: { id: 'asc' } });
    expect(rows[0]).toMatchObject({ name: 'Alice', leftAt: now() });
    expect(rows[1]).toMatchObject({ name: 'Bob', ip: null, country: null, source: 'reconciled', leftAt: null });
    expect(j.online().map((p) => p.name)).toEqual(['Bob']);
    expect(j.online()[0].hasIp).toBe(false);
    expect(events.map((e) => (e as { kind: string }).kind)).toEqual(['join', 'leave', 'join']);
  });

  it('does not close a session younger than the grace period', async () => {
    const { j } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(1000);
    await j.reconcile([]);
    expect(j.online().map((p) => p.name)).toEqual(['Alice']);
  });

  it('does not recreate a player who left within the grace period', async () => {
    const { j } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(GRACE_MS + 1000);
    await j.handleLine(L('Alice left the game'));
    advance(1000);
    await j.reconcile(['Alice']);
    expect(j.online()).toEqual([]);
    expect(await prisma.playerSession.count()).toBe(1);
  });

  it('ignores names that are not valid player names', async () => {
    const { j } = journal();
    await j.reconcile(['a-b', '']);
    expect(await prisma.playerSession.count()).toBe(0);
  });
});

describe('PlayerJournal start and purge', () => {
  it('closes orphan sessions at the last known metric sample', async () => {
    const joinedAt = new Date(t - 3_600_000);
    const lastTick = new Date(t - 600_000);
    await prisma.playerSession.create({ data: { name: 'Old', source: 'log', joinedAt } });
    await prisma.metricSample.create({ data: { at: lastTick, status: 'ready' } });
    const { j } = journal();
    await j.start();
    expect((await prisma.playerSession.findFirst())?.leftAt).toEqual(lastTick);
    expect(j.online()).toEqual([]);
  });

  it('never sets leftAt before joinedAt', async () => {
    const joinedAt = new Date(t - 60_000);
    await prisma.playerSession.create({ data: { name: 'Old', source: 'log', joinedAt } });
    await prisma.metricSample.create({ data: { at: new Date(t - 600_000), status: 'ready' } });
    const { j } = journal();
    await j.start();
    expect((await prisma.playerSession.findFirst())?.leftAt).toEqual(joinedAt);
  });

  it('purges rows older than the retention but keeps open sessions', async () => {
    await saveRetentionDays(prisma, 7);
    const old = new Date(t - 10 * 86_400_000);
    await prisma.playerSession.create({ data: { name: 'Old', source: 'log', joinedAt: old, leftAt: old } });
    await prisma.playerSession.create({ data: { name: 'Stuck', source: 'log', joinedAt: old } });
    await prisma.playerSession.create({ data: { name: 'Recent', source: 'log', joinedAt: now(), leftAt: now() } });
    await prisma.playerLoginFailure.create({ data: { name: 'X', reason: 'other', message: 'm', createdAt: old } });
    await prisma.webLogin.create({ data: { username: 'u', ip: '1.2.3.4', success: true, createdAt: old } });
    const { j } = journal();
    await j.purge();
    expect((await prisma.playerSession.findMany()).map((r) => r.name).sort()).toEqual(['Recent', 'Stuck']);
    expect(await prisma.playerLoginFailure.count()).toBe(0);
    expect(await prisma.webLogin.count()).toBe(0);
  });

  it('purges nothing when retention is 0', async () => {
    await saveRetentionDays(prisma, 0);
    const old = new Date(t - 400 * 86_400_000);
    await prisma.webLogin.create({ data: { username: 'u', ip: '1.2.3.4', success: true, createdAt: old } });
    await journal().j.purge();
    expect(await prisma.webLogin.count()).toBe(1);
  });

  it('serializes concurrent lines', async () => {
    const { j } = journal();
    await Promise.all([
      j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)')),
      j.handleLine(L('Alice left the game')),
      j.handleLine(L('Alice[/8.8.8.8:2] logged in with entity id 2 at (0, 64, 0)')),
    ]);
    expect(j.online()).toHaveLength(1);
    expect(await prisma.playerSession.count()).toBe(2);
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-journal.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémentation**

Créer `packages/backend/src/players/player-journal.ts` :

```ts
import { EventEmitter } from 'events';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { LogLine, OnlinePlayer, ServerStatus } from '@mc/common';
import { parsePlayerLine, classifyRefusal } from './parse-player-line.js';
import { readUserCache } from './data-files.js';
import { loadRetentionDays } from './retention.js';
import { lookupCountry } from '../utils/geo.js';
import { logger } from '../utils/logger.js';

/** Fenêtre pendant laquelle un `list` RCON antérieur à la ligne de log ne doit pas contredire celle-ci. */
export const GRACE_MS = 30_000;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

interface OpenSession { id: number; name: string; uuid: string | null; ip: string | null; country: string | null; joinedAt: Date }
const toOnline = (s: OpenSession): OnlinePlayer => ({ name: s.name, uuid: s.uuid, joinedAt: s.joinedAt.toISOString(), country: s.country, hasIp: s.ip !== null });

export class PlayerJournal extends EventEmitter {
  /** Sessions ouvertes, clé = nom en minuscules. */
  private open = new Map<string, OpenSession>();
  private pendingUuid = new Map<string, string>();
  private recentlyLeft = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private prisma: PrismaClient, private dataDir: string, private now: () => Date = () => new Date()) { super(); }

  online(): OnlinePlayer[] {
    return [...this.open.values()].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).map(toOnline);
  }

  /** IP de la session ouverte d'un joueur (pour `ban-ip` côté serveur) ; jamais envoyée au navigateur. */
  currentIp(name: string): string | null { return this.open.get(name.toLowerCase())?.ip ?? null; }

  /** Au démarrage : ferme en base les sessions restées ouvertes par un arrêt du backend. */
  async start(): Promise<void> {
    const last = await this.prisma.metricSample.findFirst({ orderBy: { at: 'desc' }, select: { at: true } });
    const orphans = await this.prisma.playerSession.findMany({ where: { leftAt: null } });
    for (const s of orphans) {
      const leftAt = last && last.at.getTime() > s.joinedAt.getTime() ? last.at : s.joinedAt;
      await this.prisma.playerSession.update({ where: { id: s.id }, data: { leftAt } });
    }
    if (orphans.length) logger.info({ count: orphans.length }, 'closed orphan player sessions');
  }

  handleLine(line: LogLine): Promise<void> { return this.enqueue(() => this.processLine(line)); }
  reconcile(names: string[]): Promise<void> { return this.enqueue(() => this.doReconcile(names)); }
  closeAll(): Promise<void> { return this.enqueue(async () => { const at = this.now(); for (const key of [...this.open.keys()]) await this.close(key, at); }); }
  onStatus(status: ServerStatus): Promise<void> {
    if (status === 'stopped' || status === 'stopping' || status === 'unavailable') return this.closeAll();
    return Promise.resolve();
  }

  async purge(): Promise<void> {
    const days = await loadRetentionDays(this.prisma);
    if (days <= 0) return;
    const before = new Date(this.now().getTime() - days * 86_400_000);
    await this.prisma.playerSession.deleteMany({ where: { joinedAt: { lt: before }, leftAt: { not: null } } });
    await this.prisma.playerLoginFailure.deleteMany({ where: { createdAt: { lt: before } } });
    await this.prisma.webLogin.deleteMany({ where: { createdAt: { lt: before } } });
  }

  /** Toutes les mutations passent par une file : deux lignes consécutives ne se chevauchent jamais. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const p = this.queue.then(fn, fn).catch((err) => logger.warn({ err }, 'player journal step failed'));
    this.queue = p;
    return p;
  }

  private async lookupUuid(name: string): Promise<string | null> {
    const key = name.toLowerCase();
    const pending = this.pendingUuid.get(key);
    if (pending) { this.pendingUuid.delete(key); return pending; }
    const cache = await readUserCache(this.dataDir);
    return cache.find((u) => u.name.toLowerCase() === key)?.uuid ?? null;
  }

  private async openSession(name: string, ip: string | null, source: 'log' | 'reconciled', at: Date): Promise<void> {
    const key = name.toLowerCase();
    if (this.open.has(key)) await this.close(key, at);
    const uuid = await this.lookupUuid(name);
    const country = ip ? lookupCountry(ip).country : null;
    const row = await this.prisma.playerSession.create({ data: { uuid, name, ip, country, source, joinedAt: at } });
    const s: OpenSession = { id: row.id, name, uuid, ip, country, joinedAt: at };
    this.open.set(key, s);
    this.recentlyLeft.delete(key);
    this.emit('session', { kind: 'join', player: toOnline(s) });
  }

  private async close(key: string, at: Date): Promise<void> {
    const s = this.open.get(key);
    if (!s) return;
    this.open.delete(key);
    this.recentlyLeft.set(key, at.getTime());
    await this.prisma.playerSession.update({ where: { id: s.id }, data: { leftAt: at } });
    this.emit('session', { kind: 'leave', player: toOnline(s), leftAt: at.toISOString() });
  }

  private async processLine(line: LogLine): Promise<void> {
    const ev = parsePlayerLine(line.message);
    if (!ev) return;
    const at = this.now();
    switch (ev.type) {
      case 'uuid': this.pendingUuid.set(ev.name.toLowerCase(), ev.uuid); return;
      case 'join': await this.openSession(ev.name, ev.ip || null, 'log', at); return;
      case 'leave': await this.close(ev.name.toLowerCase(), at); return;
      case 'refused':
        await this.prisma.playerLoginFailure.create({ data: {
          name: ev.name, ip: ev.ip, country: ev.ip ? lookupCountry(ev.ip).country : null,
          reason: classifyRefusal(ev.message), message: ev.message.slice(0, 200), createdAt: at,
        } });
        return;
    }
  }

  private async doReconcile(names: string[]): Promise<void> {
    const at = this.now();
    const t = at.getTime();
    const wanted = new Map(names.filter((n) => NAME_RE.test(n)).map((n) => [n.toLowerCase(), n]));
    for (const [key, s] of [...this.open]) {
      if (!wanted.has(key) && t - s.joinedAt.getTime() > GRACE_MS) await this.close(key, at);
    }
    for (const [key, name] of wanted) {
      if (this.open.has(key)) continue;
      const left = this.recentlyLeft.get(key);
      if (left !== undefined && t - left <= GRACE_MS) continue;
      await this.openSession(name, null, 'reconciled', at);
    }
  }
}
```

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-journal.test.ts`
Expected: PASS (16 tests).

**Rappel pour l'implémenteur :** l'onglet En ligne de la tâche 11 ne connaît pas l'IP des joueurs (jamais envoyée). Le ban IP passe donc par `POST /api/players/:name/ban-ip` (tâche 7), qui lit `journal.currentIp(name)`.

```bash
git add packages/backend/src/players/retention.ts packages/backend/src/players/player-journal.ts packages/backend/src/players/player-journal.test.ts
git commit -m "feat(lot2a): journal des sessions joueurs avec réconciliation RCON et rétention"
```

---

### Task 5: Journal des connexions MC Manager

**Files:**
- Create: `packages/backend/src/auth/web-login-journal.ts`
- Modify: `packages/backend/src/routes/auth.routes.ts` (handlers `/login`, `/login/mfa`, `/trusted/session`)
- Test: `packages/backend/src/auth/web-login-journal.test.ts`, `packages/backend/src/routes/auth.routes.login-journal.test.ts`

**Interfaces:**
- Consumes: `normalizeIp`, `lookupCountry` (tâche 1), modèle `webLogin`.
- Produces: `recordWebLogin(prisma, rec: { username: string; userId: number | null; ip: string | undefined; success: boolean; reason?: WebLoginReason | null }): void` (synchrone, ne rejette jamais).

- [ ] **Step 1: Test du helper (échec attendu)**

Créer `packages/backend/src/auth/web-login-journal.test.ts` :

```ts
import { describe, it, expect, vi, afterAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { recordWebLogin } from './web-login-journal.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('recordWebLogin', () => {
  it('writes a normalized row with a country', async () => {
    recordWebLogin(prisma, { username: 'alice', userId: 1, ip: '::ffff:8.8.8.8', success: true });
    await settle();
    const row = await prisma.webLogin.findFirst({ where: { username: 'alice' } });
    expect(row).toMatchObject({ userId: 1, ip: '8.8.8.8', success: true, reason: null });
    expect(row?.country).toMatch(/^[A-Z]{2}$/);
  });
  it('writes failures with their reason and an unknown ip placeholder', async () => {
    recordWebLogin(prisma, { username: 'nobody', userId: null, ip: undefined, success: false, reason: 'unknown_user' });
    await settle();
    expect(await prisma.webLogin.findFirst({ where: { username: 'nobody' } })).toMatchObject({ ip: 'unknown', country: null, success: false, reason: 'unknown_user' });
  });
  it('never throws when the write fails', async () => {
    const broken = { webLogin: { create: vi.fn().mockRejectedValue(new Error('db down')) } } as never;
    expect(() => recordWebLogin(broken, { username: 'x', userId: null, ip: '1.2.3.4', success: true })).not.toThrow();
    await settle();
  });
  it('truncates an oversized username', async () => {
    recordWebLogin(prisma, { username: 'a'.repeat(500), userId: null, ip: '1.2.3.4', success: false, reason: 'unknown_user' });
    await settle();
    expect((await prisma.webLogin.findFirst({ where: { username: { startsWith: 'aaaa' } } }))?.username).toHaveLength(64);
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/auth/web-login-journal.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Helper**

Créer `packages/backend/src/auth/web-login-journal.ts` :

```ts
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { WebLoginReason } from '@mc/common';
import { lookupCountry, normalizeIp } from '../utils/geo.js';
import { logger } from '../utils/logger.js';

export interface WebLoginRecord {
  username: string;
  userId: number | null;
  ip: string | undefined;
  success: boolean;
  reason?: WebLoginReason | null;
}

/**
 * Journalise une tentative de connexion à MC Manager. « Au mieux » : la promesse n'est pas
 * attendue et une erreur d'écriture n'atteint jamais la réponse d'authentification.
 */
export function recordWebLogin(prisma: PrismaClient, rec: WebLoginRecord): void {
  const ip = normalizeIp(rec.ip ?? '') || 'unknown';
  const country = lookupCountry(ip).country;
  Promise.resolve()
    .then(() => prisma.webLogin.create({ data: { username: rec.username.slice(0, 64), userId: rec.userId, ip, country, success: rec.success, reason: rec.reason ?? null } }))
    .catch((err) => logger.warn({ err }, 'web login journal write failed'));
}
```

- [ ] **Step 3: Test des routes (échec attendu)**

Créer `packages/backend/src/routes/auth.routes.login-journal.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { testPrisma } from '../test-db.js';
import { authRoutes } from './auth.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.locals.prisma = prisma;
  a.use('/api/auth', authRoutes);
  a.use(errorHandler);
  return a;
}

async function lastRow() {
  await new Promise((r) => setTimeout(r, 50));
  return prisma.webLogin.findFirst({ orderBy: { id: 'desc' } });
}

describe('login journal', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { username: 'alice', displayName: 'Alice', role: 'admin', passwordHash: await bcrypt.hash('Correct-horse-1!', 4) } });
    await prisma.user.create({ data: { username: 'off', displayName: 'Off', role: 'viewer', enabled: false, passwordHash: await bcrypt.hash('Correct-horse-1!', 4) } });
  });

  it('records an unknown user', async () => {
    const res = await request(app()).post('/api/auth/login').send({ username: 'nobody', password: 'x' });
    expect(res.status).toBe(401);
    expect(await lastRow()).toMatchObject({ username: 'nobody', userId: null, success: false, reason: 'unknown_user' });
  });
  it('records a disabled account', async () => {
    await request(app()).post('/api/auth/login').send({ username: 'off', password: 'Correct-horse-1!' });
    expect(await lastRow()).toMatchObject({ username: 'off', success: false, reason: 'disabled' });
  });
  it('records a bad password with the user id', async () => {
    await request(app()).post('/api/auth/login').send({ username: 'alice', password: 'wrong' });
    const row = await lastRow();
    expect(row).toMatchObject({ username: 'alice', success: false, reason: 'bad_password' });
    expect(row?.userId).not.toBeNull();
  });
  it('records a success', async () => {
    const res = await request(app()).post('/api/auth/login').send({ username: 'alice', password: 'Correct-horse-1!' });
    expect(res.status).toBe(200);
    expect(await lastRow()).toMatchObject({ username: 'alice', success: true, reason: null });
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/routes/auth.routes.login-journal.test.ts`
Expected: FAIL (aucune ligne `webLogin` écrite).

- [ ] **Step 4: Câblage dans auth.routes.ts**

Ajouter les imports en tête de `packages/backend/src/routes/auth.routes.ts` :

```ts
import type { WebLoginReason } from '@mc/common';
import { recordWebLogin } from '../auth/web-login-journal.js';
```

Remplacer le début du handler `POST /login` (jusqu'au test du mot de passe inclus) par :

```ts
authRoutes.post('/login', async (req: Request, res: Response, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) throw new AppError(400, 'Username and password required');

    const prisma = req.app.locals.prisma;

    const user = await prisma.user.findUnique({ where: { username } });
    const journal = (success: boolean, reason?: WebLoginReason) =>
      recordWebLogin(prisma, { username: String(username), userId: user?.id ?? null, ip: req.ip, success, reason });

    if (!canLocalLogin(user)) {
      journal(false, !user ? 'unknown_user' : 'disabled');
      throw new AppError(401, 'Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash as string);
    if (!valid) {
      journal(false, 'bad_password');
      throw new AppError(401, 'Invalid credentials');
    }
    journal(true);
```

Le reste du handler (`mustChangePassword`, `gateAfterPassword`, `maybeTrustDevice`, `res.json`) est inchangé.

Dans `POST /login/mfa`, remplacer le bloc du code de secours et l'émission de session :

```ts
    const okTotp = verifyTotp(String(code), decrypt(user.mfaSecret));
    if (!okTotp) {
      // Fall back to a one-time recovery code
      const stored: string[] = user.mfaRecoveryCodes ? JSON.parse(decrypt(user.mfaRecoveryCodes)) : [];
      const remaining = consumeRecoveryCode(String(code), stored);
      if (!remaining) {
        recordWebLogin(prisma, { username: user.username, userId: user.id, ip: req.ip, success: false, reason: 'mfa_failed' });
        throw new AppError(401, 'Invalid code');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaRecoveryCodes: encrypt(JSON.stringify(remaining)) },
      });
    }

    // The MFA step always issues a full session, so (unlike /login) no accessToken guard is needed.
    recordWebLogin(prisma, { username: user.username, userId: user.id, ip: req.ip, success: true, reason: 'mfa' });
    await maybeTrustDevice(prisma, req, res, user.id, req.body.trustDevice);
    res.json(await issueSession(prisma, user));
```

Dans `POST /trusted/session`, avant `res.json(await issueSession(prisma, user));` :

```ts
    recordWebLogin(prisma, { username: user.username, userId: user.id, ip: req.ip, success: true, reason: 'trusted_device' });
```

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/auth src/routes/auth.routes.login-journal.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: aucune erreur.

```bash
git add packages/backend/src/auth/web-login-journal.ts packages/backend/src/auth/web-login-journal.test.ts packages/backend/src/routes/auth.routes.ts packages/backend/src/routes/auth.routes.login-journal.test.ts
git commit -m "feat(lot2a): journal des connexions à MC Manager"
```

---

### Task 6: Service PlayerAdmin (commandes RCON)

**Files:**
- Create: `packages/backend/src/players/player-admin.ts`
- Test: `packages/backend/src/players/player-admin.test.ts`

**Interfaces:**
- Consumes: `stripColors` (`rcon/parsers.ts`), `AppError(status, message, details?)`.
- Produces: `assertName(v: unknown): string`, `assertIp(v: unknown): string`, `assertReason(v: unknown): string | undefined`, `class PlayerAdmin extends EventEmitter` avec `constructor(rcon: { send(cmd: string): Promise<string> })` et les méthodes `kick(name, reason?)`, `ban(name, reason?)`, `banIp(ip, reason?)`, `pardon(name)`, `pardonIp(ip)`, `op(name)`, `deop(name)`, `whitelistAdd(name)`, `whitelistRemove(name)`, `whitelistEnabled(on: boolean)`, toutes `Promise<string>` (réponse brute du serveur). Événement `'listsChanged'` après tout succès sauf `kick`.

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/backend/src/players/player-admin.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import { PlayerAdmin, assertName, assertIp, assertReason } from './player-admin.js';
import { AppError } from '../middleware/error-handler.js';

function admin(responses: Record<string, string>) {
  const send = vi.fn(async (cmd: string) => responses[cmd] ?? 'Unknown or incomplete command');
  const a = new PlayerAdmin({ send });
  const changed = vi.fn(); a.on('listsChanged', changed);
  return { a, send, changed };
}
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, (e) => e as AppError);

describe('validation', () => {
  it.each(['Alice', 'a_b_c', 'x'.repeat(16)])('accepts %s', (n) => expect(assertName(n)).toBe(n));
  it.each(['ab', 'a-b', 'x'.repeat(17), 'Alice reason', '', 42, null, 'say hi'])('rejects %j', (n) => expect(() => assertName(n)).toThrow(AppError));
  it.each(['1.2.3.4', '2001:db8::1'])('accepts ip %s', (ip) => expect(assertIp(ip)).toBe(ip));
  it.each(['1.2.3.4 reason', '::1\nsay hi', 'Alice', '', '1.2.3'])('rejects ip %j', (ip) => expect(() => assertIp(ip)).toThrow(AppError));
  it('accepts an optional reason and strips it', () => {
    expect(assertReason(undefined)).toBeUndefined();
    expect(assertReason('')).toBeUndefined();
    expect(assertReason('  griefing ')).toBe('griefing');
  });
  it.each(['a\nb', 'a\rb', 'x'.repeat(101)])('rejects reason %j', (r) => expect(() => assertReason(r)).toThrow(AppError));
});

describe('PlayerAdmin commands', () => {
  it('kick with reason', async () => {
    const { a, send, changed } = admin({ 'kick Alice griefing': 'Kicked Alice: griefing' });
    expect(await a.kick('Alice', 'griefing')).toBe('Kicked Alice: griefing');
    expect(send).toHaveBeenCalledWith('kick Alice griefing');
    expect(changed).not.toHaveBeenCalled();
  });
  it('kick unknown player is 404', async () => {
    const { a } = admin({ 'kick Bob': 'No player was found' });
    expect((await fail(a.kick('Bob'))).statusCode).toBe(404);
  });
  it('ban and already banned', async () => {
    const { a, changed } = admin({ 'ban Alice': 'Banned Alice: Banned by an operator', 'ban Bob': 'Nothing changed. The player is already banned' });
    expect(await a.ban('Alice')).toMatch(/^Banned Alice/);
    expect(changed).toHaveBeenCalledOnce();
    expect((await fail(a.ban('Bob'))).statusCode).toBe(409);
  });
  it('ban unknown player is 404', async () => {
    const { a } = admin({ 'ban Zed': 'That player does not exist' });
    expect((await fail(a.ban('Zed'))).statusCode).toBe(404);
  });
  it('ban-ip and pardon-ip', async () => {
    const { a } = admin({ 'ban-ip 1.2.3.4 spam': 'Banned IP 1.2.3.4: spam', 'pardon-ip 1.2.3.4': 'Unbanned IP 1.2.3.4', 'ban-ip 5.6.7.8': 'Nothing changed. That IP is already banned' });
    expect(await a.banIp('1.2.3.4', 'spam')).toMatch(/^Banned IP/);
    expect(await a.pardonIp('1.2.3.4')).toMatch(/^Unbanned IP/);
    expect((await fail(a.banIp('5.6.7.8'))).statusCode).toBe(409);
  });
  it('pardon, op, deop', async () => {
    const { a } = admin({ 'pardon Alice': 'Unbanned Alice', 'op Alice': 'Made Alice a server operator', 'deop Alice': 'Made Alice no longer a server operator', 'pardon Bob': "Nothing changed. The player isn't banned", 'op Bob': 'Nothing changed. The player already is an operator' });
    expect(await a.pardon('Alice')).toBe('Unbanned Alice');
    expect(await a.op('Alice')).toMatch(/server operator/);
    expect(await a.deop('Alice')).toMatch(/no longer/);
    expect((await fail(a.pardon('Bob'))).statusCode).toBe(409);
    expect((await fail(a.op('Bob'))).statusCode).toBe(409);
  });
  it('whitelist add/remove reload the list, on/off', async () => {
    const { a, send } = admin({ 'whitelist add Alice': 'Added Alice to the whitelist', 'whitelist reload': 'Reloaded the whitelist', 'whitelist remove Alice': 'Removed Alice from the whitelist', 'whitelist on': 'Turned on the whitelist', 'whitelist off': 'Turned off the whitelist', 'whitelist add Bob': 'Player is already whitelisted', 'whitelist add Zed': 'That player does not exist' });
    expect(await a.whitelistAdd('Alice')).toMatch(/^Added/);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['whitelist add Alice', 'whitelist reload']);
    expect(await a.whitelistRemove('Alice')).toMatch(/^Removed/);
    expect(await a.whitelistEnabled(true)).toMatch(/Turned on/);
    expect(await a.whitelistEnabled(false)).toMatch(/Turned off/);
    expect((await fail(a.whitelistAdd('Bob'))).statusCode).toBe(409);
    expect((await fail(a.whitelistAdd('Zed'))).statusCode).toBe(404);
  });
  it('unexpected response is 502 with the raw text as details', async () => {
    const { a, changed } = admin({ 'op Alice': 'Unknown or incomplete command, see below for error' });
    const err = await fail(a.op('Alice'));
    expect(err.statusCode).toBe(502);
    expect(err.details).toContain('Unknown or incomplete');
    expect(changed).not.toHaveBeenCalled();
  });
  it('strips color codes before matching', async () => {
    const { a } = admin({ 'op Alice': '§aMade Alice a server operator§r' });
    expect(await a.op('Alice')).toBe('Made Alice a server operator');
  });
  it('validates before sending', async () => {
    const { a, send } = admin({});
    await expect(a.kick('a b')).rejects.toBeInstanceOf(AppError);
    await expect(a.banIp('1.2.3.4 x')).rejects.toBeInstanceOf(AppError);
    expect(send).not.toHaveBeenCalled();
  });
  it('propagates a 503 from rcon', async () => {
    const a = new PlayerAdmin({ send: vi.fn().mockRejectedValue(new AppError(503, 'RCON not connected')) });
    expect((await fail(a.op('Alice'))).statusCode).toBe(503);
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-admin.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémentation**

Créer `packages/backend/src/players/player-admin.ts` :

```ts
import { EventEmitter } from 'events';
import { isIP } from 'net';
import { AppError } from '../middleware/error-handler.js';
import { stripColors } from '../rcon/parsers.js';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MAX_REASON = 100;

export function assertName(v: unknown): string {
  if (typeof v !== 'string' || !NAME_RE.test(v)) throw new AppError(400, 'Invalid player name');
  return v;
}
export function assertIp(v: unknown): string {
  if (typeof v !== 'string' || isIP(v.trim()) === 0 || v !== v.trim()) throw new AppError(400, 'Invalid IP address');
  return v;
}
/** Raison optionnelle : absente ou vide → undefined ; une ligne de 1 à 100 caractères sinon. */
export function assertReason(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new AppError(400, 'Invalid reason');
  const r = v.trim();
  if (!r) return undefined;
  if (r.length > MAX_REASON || /[\r\n]/.test(r)) throw new AppError(400, `Reason must be a single line of at most ${MAX_REASON} characters`);
  return r;
}

interface Rule { re: RegExp; status: number; message: string }
const ALREADY: Rule = { re: /nothing changed|already|isn't|is not/i, status: 409, message: 'Nothing changed' };
const UNKNOWN: Rule = { re: /does not exist|no player was found|unknown player/i, status: 404, message: 'Player not found' };
const BAD_IP: Rule = { re: /invalid ip/i, status: 400, message: 'Invalid IP address' };
const withReason = (cmd: string, reason?: string) => (reason ? `${cmd} ${reason}` : cmd);

/**
 * Commandes d'administration des joueurs. Les arguments sont validés ici, avant tout envoi :
 * rien d'autre qu'un nom, une IP ou une raison sur une ligne n'atteint la console RCON.
 */
export class PlayerAdmin extends EventEmitter {
  constructor(private rcon: { send(cmd: string): Promise<string> }) { super(); }

  private async run(cmd: string, ok: RegExp, rules: Rule[], changesLists = true): Promise<string> {
    const raw = stripColors(await this.rcon.send(cmd)).trim();
    if (ok.test(raw)) { if (changesLists) this.emit('listsChanged'); return raw; }
    for (const r of rules) if (r.re.test(raw)) throw new AppError(r.status, r.message, raw);
    throw new AppError(502, 'Unexpected server response', raw);
  }

  kick(name: unknown, reason?: unknown): Promise<string> {
    return this.run(withReason(`kick ${assertName(name)}`, assertReason(reason)), /^Kicked /, [UNKNOWN], false);
  }
  ban(name: unknown, reason?: unknown): Promise<string> {
    return this.run(withReason(`ban ${assertName(name)}`, assertReason(reason)), /^Banned /, [ALREADY, UNKNOWN]);
  }
  banIp(ip: unknown, reason?: unknown): Promise<string> {
    return this.run(withReason(`ban-ip ${assertIp(ip)}`, assertReason(reason)), /^Banned IP/, [ALREADY, BAD_IP]);
  }
  pardon(name: unknown): Promise<string> { return this.run(`pardon ${assertName(name)}`, /^Unbanned /, [ALREADY, UNKNOWN]); }
  pardonIp(ip: unknown): Promise<string> { return this.run(`pardon-ip ${assertIp(ip)}`, /^Unbanned IP/, [ALREADY, BAD_IP]); }
  op(name: unknown): Promise<string> { return this.run(`op ${assertName(name)}`, /^Made .* a server operator/, [ALREADY, UNKNOWN]); }
  deop(name: unknown): Promise<string> { return this.run(`deop ${assertName(name)}`, /^Made .* no longer a server operator/, [ALREADY, UNKNOWN]); }
  async whitelistAdd(name: unknown): Promise<string> {
    const r = await this.run(`whitelist add ${assertName(name)}`, /^Added /, [ALREADY, UNKNOWN]);
    await this.rcon.send('whitelist reload').catch(() => undefined);
    return r;
  }
  async whitelistRemove(name: unknown): Promise<string> {
    const r = await this.run(`whitelist remove ${assertName(name)}`, /^Removed /, [ALREADY, UNKNOWN]);
    await this.rcon.send('whitelist reload').catch(() => undefined);
    return r;
  }
  whitelistEnabled(on: boolean): Promise<string> {
    return this.run(on ? 'whitelist on' : 'whitelist off', on ? /^Turned on/ : /^Turned off/, [ALREADY]);
  }
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-admin.test.ts`
Expected: PASS.

```bash
git add packages/backend/src/players/player-admin.ts packages/backend/src/players/player-admin.test.ts
git commit -m "feat(lot2a): commandes d'administration des joueurs par RCON"
```

---

### Task 7: Fiche joueur et routes joueurs, bans, listes, whitelist

**Files:**
- Create: `packages/backend/src/utils/pagination.ts`
- Create: `packages/backend/src/players/player-sheet.ts`
- Create: `packages/backend/src/routes/players.routes.ts`
- Test: `packages/backend/src/players/player-sheet.test.ts`, `packages/backend/src/routes/players.routes.test.ts`

**Interfaces:**
- Consumes: `PlayerJournal.online()` et `currentIp(name)` via `req.app.locals.journal`, `PlayerAdmin` via `req.app.locals.playerAdmin`, `req.app.locals.dataDir: string`, `readLists`, `readUserCache`, `readPlayerStats`, `isUuid` (tâche 3), `assertName`, `assertIp`, `assertReason` (tâche 6), `audit`, `requireRole`.
- Produces:
  - `parsePage(query): { page: number; limit: number; skip: number }`
  - `dailyMinutes(sessions, now, days = 30): { day: string; minutes: number }[]`
  - `buildPlayerSheet(prisma, dataDir, uuid, opts: { withIp: boolean; online: OnlinePlayer[]; now?: Date }): Promise<PlayerSheet | null>`
  - routeurs `playersRoutes` (`/api/players`), `bansRoutes` (`/api/bans`), `listsRoutes` (`/api/lists`), `whitelistRoutes` (`/api/whitelist`).

- [ ] **Step 1: Pagination**

Créer `packages/backend/src/utils/pagination.ts` :

```ts
import { AppError } from '../middleware/error-handler.js';

export interface PageParams { page: number; limit: number; skip: number }

/** `page` ≥ 1, `limit` 1..100 (défaut 50) ; 400 sinon. */
export function parsePage(query: Record<string, unknown>): PageParams {
  const page = parseInt(String(query.page ?? '1'), 10);
  const limit = parseInt(String(query.limit ?? '50'), 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'Invalid pagination');
  return { page, limit, skip: (page - 1) * limit };
}
```

- [ ] **Step 2: Test de la fiche (échec attendu)**

Créer `packages/backend/src/players/player-sheet.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { testPrisma } from '../test-db.js';
import { buildPlayerSheet, dailyMinutes } from './player-sheet.js';

const prisma = testPrisma();
const dir = mkdtempSync(path.join(tmpdir(), 'mc-sheet-'));
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const now = new Date('2026-10-10T12:00:00Z');
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);

describe('dailyMinutes', () => {
  it('splits a session across UTC day boundaries and fills 30 days', () => {
    const out = dailyMinutes([{ joinedAt: new Date('2026-10-09T23:30:00Z'), leftAt: new Date('2026-10-10T00:30:00Z') }], now);
    expect(out).toHaveLength(30);
    expect(out.at(-1)).toEqual({ day: '2026-10-10', minutes: 30 });
    expect(out.at(-2)).toEqual({ day: '2026-10-09', minutes: 30 });
    expect(out[0].day).toBe('2026-09-11');
  });
  it('counts an open session up to now and ignores sessions outside the window', () => {
    const out = dailyMinutes([{ joinedAt: h(1), leftAt: null }, { joinedAt: new Date('2026-01-01T00:00:00Z'), leftAt: new Date('2026-01-01T01:00:00Z') }], now);
    expect(out.at(-1)).toEqual({ day: '2026-10-10', minutes: 60 });
    expect(out.reduce((a, b) => a + b.minutes, 0)).toBe(60);
  });
});

describe('buildPlayerSheet', () => {
  beforeEach(async () => {
    await prisma.playerSession.deleteMany();
    for (const f of ['ops.json', 'whitelist.json', 'banned-players.json', 'usercache.json']) rmSync(path.join(dir, f), { force: true });
  });

  it('returns null for an invalid or unknown uuid', async () => {
    expect(await buildPlayerSheet(prisma, dir, '../x', { withIp: true, online: [] })).toBeNull();
    expect(await buildPlayerSheet(prisma, dir, UUID, { withIp: true, online: [] })).toBeNull();
  });

  it('aggregates sessions, names, flags and stats', async () => {
    await prisma.playerSession.createMany({ data: [
      { uuid: UUID, name: 'OldName', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: h(30), leftAt: h(29) },
      { uuid: UUID, name: 'Alice', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: h(3), leftAt: h(1) },
    ] });
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ uuid: UUID.toUpperCase(), name: 'Alice', level: 4, bypassesPlayerLimit: false }]));
    writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
    mkdirSync(path.join(dir, 'world', 'stats'), { recursive: true });
    writeFileSync(path.join(dir, 'world', 'stats', `${UUID}.json`), JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_time': 20 * 600 } } }));
    const sheet = await buildPlayerSheet(prisma, dir, UUID, { withIp: true, online: [], now });
    expect(sheet).toMatchObject({ uuid: UUID, name: 'Alice', previousNames: ['OldName'], online: false, op: true, whitelisted: false, banned: false, sessionCount: 2, playTimeObservedSeconds: 3 * 3600 });
    expect(sheet?.lastSeenAt).toBe(h(1).toISOString());
    expect(sheet?.sessions[0]).toMatchObject({ name: 'Alice', ip: '8.8.8.8', country: 'US' });
    expect(sheet?.stats?.playTimeSeconds).toBe(600);
    expect(sheet?.daily).toHaveLength(30);
  });

  it('hides ip and country for a viewer and marks the player online', async () => {
    await prisma.playerSession.create({ data: { uuid: UUID, name: 'Alice', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: h(1) } });
    const sheet = await buildPlayerSheet(prisma, dir, UUID, { withIp: false, online: [{ name: 'Alice', uuid: UUID, joinedAt: h(1).toISOString(), country: 'US', hasIp: true }], now });
    expect(sheet?.online).toBe(true);
    expect(sheet?.lastSeenAt).toBe(now.toISOString());
    expect(sheet?.sessions[0]).not.toHaveProperty('ip');
    expect(sheet?.sessions[0]).not.toHaveProperty('country');
    expect(sheet?.stats).toBeNull();
  });

  it('builds a sheet from usercache alone', async () => {
    writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Fresh', uuid: UUID, expiresOn: 'x' }]));
    const sheet = await buildPlayerSheet(prisma, dir, UUID, { withIp: true, online: [], now });
    expect(sheet).toMatchObject({ name: 'Fresh', sessionCount: 0, lastSeenAt: null, playTimeObservedSeconds: 0 });
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-sheet.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Fiche joueur**

Créer `packages/backend/src/players/player-sheet.ts` :

```ts
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { OnlinePlayer, PlayerSessionEntry, PlayerSheet, ServerLists } from '@mc/common';
import { isUuid, readLists, readPlayerStats, readUserCache } from './data-files.js';

const DAY = 86_400_000;

/** Minutes jouées par jour UTC sur les `days` derniers jours, sessions ouvertes comptées jusqu'à `now`. */
export function dailyMinutes(sessions: { joinedAt: Date; leftAt: Date | null }[], now: Date, days = 30): { day: string; minutes: number }[] {
  const end = now.getTime();
  const start = Math.floor(end / DAY) * DAY - (days - 1) * DAY;
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) buckets.set(new Date(start + i * DAY).toISOString().slice(0, 10), 0);
  for (const s of sessions) {
    let a = Math.max(s.joinedAt.getTime(), start);
    const b = Math.min((s.leftAt ?? now).getTime(), end);
    while (a < b) {
      const dayStart = Math.floor(a / DAY) * DAY;
      const segEnd = Math.min(b, dayStart + DAY);
      const key = new Date(dayStart).toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + (segEnd - a));
      a = segEnd;
    }
  }
  return [...buckets].map(([day, ms]) => ({ day, minutes: Math.round(ms / 60_000) }));
}

export interface ListFlags { op: boolean; whitelisted: boolean; banned: boolean }
/** Drapeaux d'un joueur dans les listes du serveur, par UUID puis par nom (insensible à la casse). */
export function flagsFor(lists: ServerLists, uuid: string | null, name: string): ListFlags {
  const u = uuid?.toLowerCase();
  const n = name.toLowerCase();
  const has = (rows: { uuid?: string; name: string }[]) => rows.some((r) => (u && r.uuid?.toLowerCase() === u) || r.name.toLowerCase() === n);
  return { op: has(lists.ops), whitelisted: has(lists.whitelist), banned: has(lists.bannedPlayers) };
}

export function toSessionEntry(s: { id: number; uuid: string | null; name: string; ip: string | null; country: string | null; source: string; joinedAt: Date; leftAt: Date | null }, withIp: boolean): PlayerSessionEntry {
  const base: PlayerSessionEntry = { id: s.id, uuid: s.uuid, name: s.name, source: s.source as PlayerSessionEntry['source'], joinedAt: s.joinedAt.toISOString(), leftAt: s.leftAt ? s.leftAt.toISOString() : null };
  return withIp ? { ...base, ip: s.ip, country: s.country } : base;
}

export async function buildPlayerSheet(
  prisma: PrismaClient, dataDir: string, uuidRaw: string,
  opts: { withIp: boolean; online: OnlinePlayer[]; now?: Date },
): Promise<PlayerSheet | null> {
  if (!isUuid(uuidRaw)) return null;
  const uuid = uuidRaw.toLowerCase();
  const now = opts.now ?? new Date();
  const sessions = await prisma.playerSession.findMany({ where: { uuid }, orderBy: { joinedAt: 'desc' } });
  const cached = (await readUserCache(dataDir)).find((u) => u.uuid === uuid);
  if (sessions.length === 0 && !cached) return null;
  const name = sessions[0]?.name ?? cached!.name;
  const previousNames = [...new Set(sessions.map((s) => s.name).filter((n) => n !== name))];
  const lists = await readLists(dataDir);
  const online = opts.online.some((p) => p.uuid === uuid || p.name.toLowerCase() === name.toLowerCase());
  const last = sessions[0];
  const lastSeenAt = online ? now.toISOString() : last ? (last.leftAt ?? last.joinedAt).toISOString() : null;
  const playTimeObservedSeconds = Math.round(sessions.reduce((sum, s) => sum + ((s.leftAt ?? now).getTime() - s.joinedAt.getTime()), 0) / 1000);
  return {
    uuid, name, previousNames, online, ...flagsFor(lists, uuid, name),
    lastSeenAt, sessionCount: sessions.length, playTimeObservedSeconds,
    sessions: sessions.slice(0, 30).map((s) => toSessionEntry(s, opts.withIp)),
    daily: dailyMinutes(sessions, now),
    stats: await readPlayerStats(dataDir, uuid),
  };
}
```

- [ ] **Step 4: Vérifier la fiche**

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-sheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Test des routes (échec attendu)**

Créer `packages/backend/src/routes/players.routes.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { testPrisma } from '../test-db.js';
import { playersRoutes, bansRoutes, listsRoutes, whitelistRoutes } from './players.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

const prisma = testPrisma();
const dir = mkdtempSync(path.join(tmpdir(), 'mc-routes-'));
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const now = new Date('2026-10-10T12:00:00Z');

const audits = () => prisma.auditLog.findMany({ orderBy: { id: 'asc' } });

function appWith(role: 'admin' | 'viewer', online: unknown[] = []) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = prisma;
  app.locals.dataDir = dir;
  app.locals.journal = { online: () => online, currentIp: (n: string) => (n === 'Alice' ? '8.8.8.8' : null) };
  app.locals.playerAdmin = {
    kick: vi.fn().mockResolvedValue('Kicked Alice'), ban: vi.fn().mockResolvedValue('Banned Alice'), banIp: vi.fn().mockResolvedValue('Banned IP 1.2.3.4'),
    pardon: vi.fn().mockResolvedValue('Unbanned Alice'), pardonIp: vi.fn().mockResolvedValue('Unbanned IP 1.2.3.4'),
    op: vi.fn().mockResolvedValue('Made Alice a server operator'), deop: vi.fn().mockResolvedValue('Made Alice no longer a server operator'),
    whitelistAdd: vi.fn().mockResolvedValue('Added Alice to the whitelist'), whitelistRemove: vi.fn().mockResolvedValue('Removed Alice from the whitelist'),
    whitelistEnabled: vi.fn().mockResolvedValue('Turned on the whitelist'),
  };
  app.use('/api/players', playersRoutes);
  app.use('/api/bans', bansRoutes);
  app.use('/api/lists', listsRoutes);
  app.use('/api/whitelist', whitelistRoutes);
  app.use(errorHandler);
  return { app, admin: app.locals.playerAdmin };
}

beforeEach(async () => {
  await prisma.playerSession.deleteMany();
  await prisma.auditLog.deleteMany();
  for (const f of ['ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json', 'usercache.json']) rmSync(path.join(dir, f), { force: true });
});

describe('GET /api/players', () => {
  it('lists known players merged by uuid with flags, newest first', async () => {
    await prisma.playerSession.createMany({ data: [
      { uuid: UUID, name: 'OldName', source: 'log', joinedAt: new Date(now.getTime() - 86_400_000), leftAt: new Date(now.getTime() - 80_000_000) },
      { uuid: UUID, name: 'Alice', source: 'log', joinedAt: new Date(now.getTime() - 7_200_000), leftAt: new Date(now.getTime() - 3_600_000) },
      { uuid: null, name: 'NoUuid', source: 'reconciled', joinedAt: new Date(now.getTime() - 1_800_000), leftAt: new Date(now.getTime() - 900_000) },
    ] });
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ uuid: UUID, name: 'Alice', level: 4, bypassesPlayerLimit: false }]));
    const res = await request(appWith('viewer').app).get('/api/players');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['NoUuid', 'Alice']);
    expect(res.body.items[1]).toMatchObject({ uuid: UUID, sessionCount: 2, op: true, whitelisted: false, banned: false, online: false });
    expect(JSON.stringify(res.body)).not.toContain('"ip"');
  });
  it('filters by name and paginates', async () => {
    await prisma.playerSession.createMany({ data: ['Alice', 'Alicia', 'Bob'].map((name, i) => ({ name, source: 'log', joinedAt: new Date(now.getTime() - i * 60_000), leftAt: new Date(now.getTime() - i * 1000) })) });
    const res = await request(appWith('viewer').app).get('/api/players?q=ali&limit=1&page=2');
    expect(res.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(res.body.items[0].name).toBe('Alicia');
  });
  it('online=1 returns the journal view', async () => {
    const online = [{ name: 'Alice', uuid: UUID, joinedAt: now.toISOString(), country: 'FR', hasIp: true }];
    const res = await request(appWith('viewer', online).app).get('/api/players?online=1');
    expect(res.body.items).toEqual(online);
  });
  it('marks an online player', async () => {
    await prisma.playerSession.create({ data: { uuid: UUID, name: 'Alice', source: 'log', joinedAt: now } });
    const res = await request(appWith('viewer', [{ name: 'Alice', uuid: UUID, joinedAt: now.toISOString(), country: null, hasIp: true }]).app).get('/api/players');
    expect(res.body.items[0].online).toBe(true);
  });
});

describe('GET /api/players/:uuid', () => {
  it('404 for unknown or invalid', async () => {
    expect((await request(appWith('viewer').app).get(`/api/players/${UUID}`)).status).toBe(404);
    expect((await request(appWith('viewer').app).get('/api/players/not-a-uuid')).status).toBe(404);
  });
  it('viewer gets the sheet without ip, admin with ip', async () => {
    await prisma.playerSession.create({ data: { uuid: UUID, name: 'Alice', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: now, leftAt: now } });
    const v = await request(appWith('viewer').app).get(`/api/players/${UUID}`);
    expect(v.status).toBe(200);
    expect(v.body.sessions[0]).not.toHaveProperty('ip');
    const a = await request(appWith('admin').app).get(`/api/players/${UUID}`);
    expect(a.body.sessions[0]).toMatchObject({ ip: '8.8.8.8', country: 'US' });
  });
});

describe('actions', () => {
  it('viewer is refused everywhere without calling the admin service', async () => {
    const { app, admin } = appWith('viewer');
    for (const [m, url] of [['post', '/api/players/Alice/kick'], ['post', '/api/players/Alice/ban'], ['post', '/api/players/Alice/ban-ip'], ['post', '/api/players/Alice/pardon'], ['post', '/api/players/Alice/op'], ['post', '/api/players/Alice/deop'], ['post', '/api/bans/ip'], ['delete', '/api/bans/ip/1.2.3.4'], ['post', '/api/whitelist/Alice'], ['delete', '/api/whitelist/Alice'], ['put', '/api/whitelist/enabled']] as const) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[m](url);
      expect(res.status, `${m} ${url}`).toBe(403);
    }
    for (const fn of Object.values(admin)) expect(fn).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });
  it('kick with reason writes the audit row before calling the server', async () => {
    const { app, admin } = appWith('admin');
    admin.kick.mockImplementation(async () => { expect(await prisma.auditLog.count()).toBe(1); return 'Kicked Alice'; });
    const res = await request(app).post('/api/players/Alice/kick').send({ reason: 'afk' });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Kicked Alice');
    expect(admin.kick).toHaveBeenCalledWith('Alice', 'afk');
    expect(await audits()).toMatchObject([{ action: 'player.kick', detail: 'Alice: afk', username: 'u' }]);
  });
  it('invalid name is 400 before audit', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/players/a%20b/kick')).status).toBe(400);
    expect(await audits()).toHaveLength(0);
    expect(admin.kick).not.toHaveBeenCalled();
  });
  it('ban, pardon, op, deop are audited with the name', async () => {
    const { app } = appWith('admin');
    for (const url of ['ban', 'pardon', 'op', 'deop']) expect((await request(app).post(`/api/players/Alice/${url}`)).status).toBe(200);
    expect((await audits()).map((a) => [a.action, a.detail])).toEqual([['player.ban', 'Alice'], ['player.pardon', 'Alice'], ['player.op', 'Alice'], ['player.deop', 'Alice']]);
  });
  it('ban-ip by player name uses the ip known server-side', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/players/Alice/ban-ip').send({ reason: 'spam' })).status).toBe(200);
    expect(admin.banIp).toHaveBeenCalledWith('8.8.8.8', 'spam');
    expect(await audits()).toMatchObject([{ action: 'player.ban_ip', detail: '8.8.8.8 (Alice): spam' }]);
    expect((await request(app).post('/api/players/Bob/ban-ip')).status).toBe(409);
    expect(await audits()).toHaveLength(1);
  });
  it('ban-ip and pardon-ip by address', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/bans/ip').send({ ip: '1.2.3.4', reason: 'spam' })).status).toBe(200);
    expect(admin.banIp).toHaveBeenCalledWith('1.2.3.4', 'spam');
    expect((await request(app).delete('/api/bans/ip/1.2.3.4')).status).toBe(200);
    expect(admin.pardonIp).toHaveBeenCalledWith('1.2.3.4');
    expect((await audits()).map((a) => [a.action, a.detail])).toEqual([['player.ban_ip', '1.2.3.4: spam'], ['player.pardon_ip', '1.2.3.4']]);
    expect((await request(app).post('/api/bans/ip').send({ ip: '1.2.3.4 x' })).status).toBe(400);
  });
  it('whitelist add/remove/enabled', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/whitelist/Alice')).status).toBe(200);
    expect((await request(app).delete('/api/whitelist/Alice')).status).toBe(200);
    expect((await request(app).put('/api/whitelist/enabled').send({ enabled: true })).status).toBe(200);
    expect(admin.whitelistEnabled).toHaveBeenCalledWith(true);
    expect((await audits()).map((a) => [a.action, a.detail])).toEqual([['whitelist.add', 'Alice'], ['whitelist.remove', 'Alice'], ['whitelist.toggle', 'on']]);
    expect((await request(app).put('/api/whitelist/enabled').send({ enabled: 'yes' })).status).toBe(400);
  });
  it('a failing action is still audited and returns its status', async () => {
    const { app, admin } = appWith('admin');
    admin.op.mockRejectedValue(new AppError(503, 'RCON not connected'));
    expect((await request(app).post('/api/players/Alice/op')).status).toBe(503);
    expect(await audits()).toHaveLength(1);
  });
});

describe('GET /api/lists', () => {
  it('returns the four lists for any role', async () => {
    writeFileSync(path.join(dir, 'banned-ips.json'), JSON.stringify([{ ip: '1.2.3.4', created: '', source: 'Server', expires: 'forever', reason: '' }]));
    const res = await request(appWith('viewer').app).get('/api/lists');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ whitelist: [], ops: [], bannedPlayers: [], bannedIps: [{ ip: '1.2.3.4' }], whitelistEnabled: false });
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/routes/players.routes.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 6: Routes**

Créer `packages/backend/src/routes/players.routes.ts` :

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuditAction, OnlinePlayer, PlayerSummary } from '@mc/common';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { parsePage } from '../utils/pagination.js';
import { readLists } from '../players/data-files.js';
import { buildPlayerSheet, flagsFor } from '../players/player-sheet.js';
import { assertIp, assertName, assertReason } from '../players/player-admin.js';
import type { PlayerAdmin } from '../players/player-admin.js';

type Handler = (req: Request, res: Response, next: NextFunction) => void;
const wrap = (fn: (req: Request, res: Response) => Promise<void>): Handler => (req, res, next) => { fn(req, res).catch(next); };
const adminOf = (req: Request): PlayerAdmin => req.app.locals.playerAdmin;

export const playersRoutes: Router = Router();

playersRoutes.get('/', wrap(async (req, res) => {
  const online: OnlinePlayer[] = req.app.locals.journal.online();
  if (req.query.online === '1') { res.json({ items: online, total: online.length, page: 1, limit: Math.max(1, online.length) }); return; }
  const { page, limit, skip } = parsePage(req.query);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const groups = await req.app.locals.prisma.playerSession.groupBy({ by: ['uuid', 'name'], _max: { joinedAt: true, leftAt: true }, _count: { _all: true } });
  // Fusion par UUID (ou par nom sans UUID) : le nom retenu est celui de la session la plus récente.
  const merged = new Map<string, { uuid: string | null; name: string; lastSeen: Date; count: number }>();
  for (const g of groups) {
    const key = g.uuid ? `u:${g.uuid}` : `n:${g.name.toLowerCase()}`;
    const joined = g._max.joinedAt ?? new Date(0);
    const lastSeen = g._max.leftAt && g._max.leftAt > joined ? g._max.leftAt : joined;
    const cur = merged.get(key);
    if (!cur) merged.set(key, { uuid: g.uuid, name: g.name, lastSeen, count: g._count._all });
    else { cur.count += g._count._all; if (lastSeen > cur.lastSeen) { cur.lastSeen = lastSeen; cur.name = g.name; } }
  }
  const lists = await readLists(req.app.locals.dataDir);
  const onlineKeys = new Set(online.map((p) => (p.uuid ? `u:${p.uuid}` : `n:${p.name.toLowerCase()}`)));
  const now = new Date();
  const all: PlayerSummary[] = [...merged].map(([key, p]) => {
    const isOnline = onlineKeys.has(key);
    return { uuid: p.uuid, name: p.name, online: isOnline, lastSeenAt: (isOnline ? now : p.lastSeen).toISOString(), sessionCount: p.count, ...flagsFor(lists, p.uuid, p.name) };
  }).filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  res.json({ items: all.slice(skip, skip + limit), total: all.length, page, limit });
}));

playersRoutes.get('/:uuid', wrap(async (req, res) => {
  const sheet = await buildPlayerSheet(req.app.locals.prisma, req.app.locals.dataDir, String(req.params.uuid), { withIp: req.user?.role === 'admin', online: req.app.locals.journal.online() });
  if (!sheet) throw new AppError(404, 'Player not found');
  res.json(sheet);
}));

/** Action sur un nom : validation, audit avant l'envoi, puis commande. Un échec RCON est audité aussi. */
function nameAction(action: AuditAction, run: (admin: PlayerAdmin, name: string, reason?: string) => Promise<string>, withReason = false): Handler {
  return wrap(async (req, res) => {
    const name = assertName(req.params.name);
    const reason = withReason ? assertReason(req.body?.reason) : undefined;
    await audit(req, action, reason ? `${name}: ${reason}` : name);
    res.json({ response: await run(adminOf(req), name, reason) });
  });
}

playersRoutes.post('/:name/kick', requireRole('admin'), nameAction('player.kick', (a, n, r) => a.kick(n, r), true));
playersRoutes.post('/:name/ban', requireRole('admin'), nameAction('player.ban', (a, n, r) => a.ban(n, r), true));
playersRoutes.post('/:name/pardon', requireRole('admin'), nameAction('player.pardon', (a, n) => a.pardon(n)));
playersRoutes.post('/:name/op', requireRole('admin'), nameAction('player.op', (a, n) => a.op(n)));
playersRoutes.post('/:name/deop', requireRole('admin'), nameAction('player.deop', (a, n) => a.deop(n)));

/** Ban de l'IP de la session en cours d'un joueur : l'IP reste côté serveur, le navigateur ne la voit jamais. */
playersRoutes.post('/:name/ban-ip', requireRole('admin'), wrap(async (req, res) => {
  const name = assertName(req.params.name);
  const reason = assertReason(req.body?.reason);
  const ip: string | null = req.app.locals.journal.currentIp(name);
  if (!ip) throw new AppError(409, 'No IP known for this player');
  await audit(req, 'player.ban_ip', reason ? `${ip} (${name}): ${reason}` : `${ip} (${name})`);
  res.json({ response: await adminOf(req).banIp(ip, reason) });
}));

export const bansRoutes: Router = Router();
bansRoutes.use(requireRole('admin'));
bansRoutes.post('/ip', wrap(async (req, res) => {
  const ip = assertIp(req.body?.ip);
  const reason = assertReason(req.body?.reason);
  await audit(req, 'player.ban_ip', reason ? `${ip}: ${reason}` : ip);
  res.json({ response: await adminOf(req).banIp(ip, reason) });
}));
bansRoutes.delete('/ip/:ip', wrap(async (req, res) => {
  const ip = assertIp(req.params.ip);
  await audit(req, 'player.pardon_ip', ip);
  res.json({ response: await adminOf(req).pardonIp(ip) });
}));

export const listsRoutes: Router = Router();
listsRoutes.get('/', wrap(async (req, res) => { res.json(await readLists(req.app.locals.dataDir)); }));

export const whitelistRoutes: Router = Router();
whitelistRoutes.use(requireRole('admin'));
whitelistRoutes.put('/enabled', wrap(async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
  await audit(req, 'whitelist.toggle', enabled ? 'on' : 'off');
  res.json({ response: await adminOf(req).whitelistEnabled(enabled) });
}));
whitelistRoutes.post('/:name', nameAction('whitelist.add', (a, n) => a.whitelistAdd(n)));
whitelistRoutes.delete('/:name', nameAction('whitelist.remove', (a, n) => a.whitelistRemove(n)));
```

- [ ] **Step 7: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/players.routes.test.ts src/players`
Expected: PASS.

Run: `pnpm typecheck`
Expected: aucune erreur.

```bash
git add packages/backend/src/utils/pagination.ts packages/backend/src/players/player-sheet.ts packages/backend/src/players/player-sheet.test.ts packages/backend/src/routes/players.routes.ts packages/backend/src/routes/players.routes.test.ts
git commit -m "feat(lot2a): fiche joueur et routes joueurs, bans, listes et whitelist"
```

---

### Task 8: Routes du journal

**Files:**
- Create: `packages/backend/src/routes/journal.routes.ts`
- Test: `packages/backend/src/routes/journal.routes.test.ts`

**Interfaces:**
- Consumes: `parsePage`, `toSessionEntry` (tâche 7), `loadRetentionDays`, `saveRetentionDays`, `MAX_RETENTION_DAYS` (tâche 4), `audit`, `requireRole`.
- Produces: routeur `journalRoutes` (`/api/journal`) : `GET /players`, `GET /failures`, `GET /web` (`q`, `from`, `to`, `page`, `limit`), `GET /retention`, `PUT /retention`.

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/backend/src/routes/journal.routes.test.ts` :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { testPrisma } from '../test-db.js';
import { journalRoutes } from './journal.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
const T0 = Date.parse('2026-10-10T12:00:00Z');
const at = (h: number) => new Date(T0 - h * 3_600_000);

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = prisma;
  app.use('/api/journal', journalRoutes);
  app.use(errorHandler);
  return { app };
}

beforeAll(async () => {
  await prisma.playerSession.createMany({ data: [
    { name: 'Alice', uuid: 'u1', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: at(5), leftAt: at(4) },
    { name: 'Bob', source: 'reconciled', joinedAt: at(2), leftAt: null },
    { name: 'Alicia', ip: '192.168.1.5', source: 'log', joinedAt: at(1), leftAt: at(0.5) },
  ] });
  await prisma.playerLoginFailure.createMany({ data: [
    { name: 'Mallory', ip: '198.51.100.7', reason: 'banned', message: 'You are banned', createdAt: at(3) },
    { name: 'Eve', reason: 'not_whitelisted', message: 'nope', createdAt: at(1) },
  ] });
  await prisma.webLogin.createMany({ data: [
    { username: 'admin', userId: 1, ip: '1.2.3.4', country: 'FR', success: true, createdAt: at(6) },
    { username: 'nobody', ip: '1.2.3.4', success: false, reason: 'unknown_user', createdAt: at(1) },
  ] });
});

describe('journal routes', () => {
  it('viewer is refused', async () => {
    const { app } = appWith('viewer');
    for (const url of ['/api/journal/players', '/api/journal/failures', '/api/journal/web', '/api/journal/retention']) expect((await request(app).get(url)).status, url).toBe(403);
    expect((await request(app).put('/api/journal/retention').send({ days: 10 })).status).toBe(403);
  });
  it('players: newest first, with ip and country, paginated', async () => {
    const res = await request(appWith('admin').app).get('/api/journal/players?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((s: { name: string }) => s.name)).toEqual(['Alicia', 'Bob']);
    expect(res.body.items[0]).toMatchObject({ ip: '192.168.1.5', country: null, leftAt: at(0.5).toISOString() });
    expect(res.body.items[1]).toMatchObject({ source: 'reconciled', ip: null, leftAt: null });
    const p2 = await request(appWith('admin').app).get('/api/journal/players?limit=2&page=2');
    expect(p2.body.items.map((s: { name: string }) => s.name)).toEqual(['Alice']);
  });
  it('players: filters by name (contains, case-insensitive) and by period', async () => {
    const byName = await request(appWith('admin').app).get('/api/journal/players?q=ALI');
    expect(byName.body.items.map((s: { name: string }) => s.name)).toEqual(['Alicia', 'Alice']);
    const byPeriod = await request(appWith('admin').app).get(`/api/journal/players?from=${at(3).toISOString()}&to=${at(0).toISOString()}`);
    expect(byPeriod.body.items.map((s: { name: string }) => s.name)).toEqual(['Alicia', 'Bob']);
    expect((await request(appWith('admin').app).get('/api/journal/players?from=yesterday')).status).toBe(400);
    expect((await request(appWith('admin').app).get('/api/journal/players?limit=500')).status).toBe(400);
  });
  it('failures and web journals', async () => {
    const f = await request(appWith('admin').app).get('/api/journal/failures?q=mal');
    expect(f.body.total).toBe(1);
    expect(f.body.items[0]).toMatchObject({ name: 'Mallory', reason: 'banned', ip: '198.51.100.7' });
    const w = await request(appWith('admin').app).get('/api/journal/web');
    expect(w.body.total).toBe(2);
    expect(w.body.items[0]).toMatchObject({ username: 'nobody', success: false, reason: 'unknown_user' });
    expect(w.body.items[1]).toMatchObject({ username: 'admin', userId: 1, country: 'FR' });
  });
  it('retention read, write, audit and validation', async () => {
    const { app } = appWith('admin');
    expect((await request(app).get('/api/journal/retention')).body).toEqual({ days: 90 });
    expect((await request(app).put('/api/journal/retention').send({ days: 30 })).body).toEqual({ days: 30 });
    expect((await request(app).get('/api/journal/retention')).body).toEqual({ days: 30 });
    expect(await prisma.auditLog.findMany()).toMatchObject([{ action: 'journal.retention', detail: '30' }]);
    for (const days of [-1, 4000, 1.5, 'x', undefined]) expect((await request(app).put('/api/journal/retention').send({ days })).status, String(days)).toBe(400);
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/routes/journal.routes.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémentation**

Créer `packages/backend/src/routes/journal.routes.ts` :

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { parsePage } from '../utils/pagination.js';
import { toSessionEntry } from '../players/player-sheet.js';
import { loadRetentionDays, saveRetentionDays, MAX_RETENTION_DAYS } from '../players/retention.js';

export const journalRoutes: Router = Router();
journalRoutes.use(requireRole('admin'));

const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

function parseDate(v: unknown, label: string): Date | undefined {
  if (v === undefined || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, `Invalid ${label} date`);
  return d;
}
/** Filtres communs : q (contient, insensible à la casse via SQLite), from/to sur le champ de date donné. */
function filters(req: Request, nameField: string, dateField: string): Record<string, unknown> {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const from = parseDate(req.query.from, 'from');
  const to = parseDate(req.query.to, 'to');
  return {
    ...(q ? { [nameField]: { contains: q } } : {}),
    ...(from || to ? { [dateField]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);

journalRoutes.get('/players', wrap(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = filters(req, 'name', 'joinedAt');
  const prisma = req.app.locals.prisma;
  const [total, rows] = await Promise.all([prisma.playerSession.count({ where }), prisma.playerSession.findMany({ where, orderBy: { joinedAt: 'desc' }, skip, take: limit })]);
  res.json({ items: rows.map((r: Parameters<typeof toSessionEntry>[0]) => toSessionEntry(r, true)), total, page, limit });
}));

journalRoutes.get('/failures', wrap(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = filters(req, 'name', 'createdAt');
  const prisma = req.app.locals.prisma;
  const [total, rows] = await Promise.all([prisma.playerLoginFailure.count({ where }), prisma.playerLoginFailure.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })]);
  res.json({ items: rows.map((r: { createdAt: Date }) => ({ ...r, createdAt: r.createdAt.toISOString() })), total, page, limit });
}));

journalRoutes.get('/web', wrap(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = filters(req, 'username', 'createdAt');
  const prisma = req.app.locals.prisma;
  const [total, rows] = await Promise.all([prisma.webLogin.count({ where }), prisma.webLogin.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })]);
  res.json({ items: rows.map((r: { createdAt: Date }) => ({ ...r, createdAt: iso(r.createdAt) })), total, page, limit });
}));

journalRoutes.get('/retention', wrap(async (req, res) => { res.json({ days: await loadRetentionDays(req.app.locals.prisma) }); }));

journalRoutes.put('/retention', wrap(async (req, res) => {
  const days = req.body?.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_RETENTION_DAYS) throw new AppError(400, `days must be an integer between 0 and ${MAX_RETENTION_DAYS}`);
  await saveRetentionDays(req.app.locals.prisma, days);
  await audit(req, 'journal.retention', String(days));
  res.json({ days });
}));
```

Note : SQLite compare `contains` sans tenir compte de la casse pour l'ASCII (collation par défaut de Prisma sur SQLite), ce que le test `q=ALI` vérifie. Si le test échoue sur ce point, remplacer par `{ contains: q, mode: 'insensitive' }` n'est pas possible sur SQLite : utiliser alors `OR: [{ name: { contains: q } }, { name: { contains: q.toLowerCase() } }, { name: { contains: q.toUpperCase() } }]` et le noter dans le rapport.

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/journal.routes.test.ts`
Expected: PASS.

```bash
git add packages/backend/src/routes/journal.routes.ts packages/backend/src/routes/journal.routes.test.ts
git commit -m "feat(lot2a): routes du journal de connexions et de la rétention"
```

---

### Task 9: Horodatage des logs, câblage backend, réconciliation par le collecteur

**Files:**
- Modify: `packages/backend/src/docker/docker-service.ts:193-198` (`timestamps: true`)
- Modify: `packages/backend/src/logs/log-streamer.ts` (retrait du préfixe, émission de la date)
- Modify: `packages/backend/src/metrics/collector.ts` (`onPlayers`)
- Modify: `packages/backend/src/players/player-journal.ts` (`handleLine(line, at?)`, filtre d'historique)
- Modify: `packages/backend/src/app.ts`, `packages/backend/src/index.ts`
- Test: `packages/backend/src/logs/log-streamer.test.ts`, `packages/backend/src/metrics/collector.test.ts`, `packages/backend/src/players/player-journal.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `LogStreamer` émet `'line'` avec `(line: LogLine, at: Date | null)` ; `CollectorDeps.onPlayers?: (names: string[]) => void` ; `PlayerJournal.handleLine(line, at?: Date | null)` ignore les lignes dont `at` est antérieur au démarrage du journal ; `app.locals.{journal, playerAdmin, dataDir}`.

**Pourquoi l'horodatage** : `LogStreamer.start()` ouvre le flux avec `tail = 500` et rejoue donc l'historique. Sans date, chaque ancienne ligne `logged in` ouvrirait une session fantôme au démarrage du backend. Docker peut préfixer chaque ligne d'une date RFC 3339 (`timestamps: true`), que le streamer retire avant le parseur du lot 1 et transmet à part.

- [ ] **Step 1: Tests du streamer (échec attendu)**

Ajouter à `packages/backend/src/logs/log-streamer.test.ts`, dans le `describe('LogStreamer')` :

```ts
  it('strips a Docker timestamp prefix and passes the date along', async () => {
    const { logs, streamer } = setup(true);
    const seen: [string, Date | null][] = [];
    streamer.on('line', (l, at) => seen.push([l.message, at]));
    await streamer.start();
    logs.write('2026-10-10T10:00:00.123456789Z [10:00:00] [main/INFO]: stamped\n[10:00:01] [main/INFO]: bare\n');
    await wait(10);
    expect(seen[0][0]).toBe('stamped');
    expect(seen[0][1]?.toISOString()).toBe('2026-10-10T10:00:00.123Z');
    expect(seen[1]).toEqual(['bare', null]);
    expect(streamer.history().map((l) => l.raw)).toEqual(['[10:00:00] [main/INFO]: stamped', '[10:00:01] [main/INFO]: bare']);
    streamer.stop();
  });
```

Run: `pnpm --filter @mc/backend exec vitest run src/logs/log-streamer.test.ts`
Expected: FAIL (`raw` contient encore le préfixe, `at` indéfini).

- [ ] **Step 2: Streamer et Docker**

Dans `packages/backend/src/docker/docker-service.ts`, méthode `logStream`, remplacer `timestamps: false` par `timestamps: true`.

Dans `packages/backend/src/logs/log-streamer.ts`, ajouter avant la classe :

```ts
/** Préfixe `timestamps: true` de Docker : `2026-10-10T10:00:00.123456789Z ` devant chaque ligne. */
const TS_PREFIX = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+Z) /;
export function splitTimestamp(raw: string): { at: Date | null; text: string } {
  const m = TS_PREFIX.exec(raw);
  if (!m) return { at: null, text: raw };
  const at = new Date(m[1]);
  return { at: Number.isNaN(at.getTime()) ? null : at, text: raw.slice(m[0].length) };
}
```

et remplacer la boucle de découpage des lignes dans `open()` :

```ts
      while ((nl = partial.indexOf('\n')) >= 0) {
        const { at, text } = splitTimestamp(partial.slice(0, nl));
        const line = parseLogLine(text);
        partial = partial.slice(nl + 1);
        this.buffer.push(line);
        if (this.buffer.length > this.cap) this.buffer.shift();
        this.emit('line', line, at);
      }
```

Run: `pnpm --filter @mc/backend exec vitest run src/logs`
Expected: PASS (les anciens tests passent toujours : sans préfixe, `at` vaut `null`).

- [ ] **Step 3: Filtre d'historique dans le journal**

Dans `packages/backend/src/players/player-journal.ts` :

- ajouter un champ `private startedAt: Date | null = null;`
- dans `start()`, première ligne : `this.startedAt = this.now();`
- remplacer `handleLine` :

```ts
  /** `at` : date Docker de la ligne. Les lignes antérieures au démarrage (historique rejoué) sont ignorées. */
  handleLine(line: LogLine, at: Date | null = null): Promise<void> {
    if (at && this.startedAt && at.getTime() < this.startedAt.getTime() - 2000) return Promise.resolve();
    return this.enqueue(() => this.processLine(line));
  }
```

Ajouter dans `player-journal.test.ts`, `describe('PlayerJournal sessions')` :

```ts
  it('ignores replayed history lines older than its start', async () => {
    const { j } = journal();
    await j.start();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'), new Date(t - 60_000));
    expect(j.online()).toEqual([]);
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'), new Date(t + 5));
    expect(j.online()).toHaveLength(1);
  });
```

Run: `pnpm --filter @mc/backend exec vitest run src/players/player-journal.test.ts`
Expected: PASS.

- [ ] **Step 4: Collecteur**

Dans `packages/backend/src/metrics/collector.ts`, ajouter à `CollectorDeps` :

```ts
  /** Noms en ligne à chaque `list` réussi (réconciliation du journal joueurs). */
  onPlayers?: (names: string[]) => void;
```

et dans `collect()`, juste après `players = parseList(await this.deps.rcon('list'));` :

```ts
        if (players) this.deps.onPlayers?.(players.names);
```

Ajouter dans `collector.test.ts`, `describe('MetricsCollector')` :

```ts
  it('hands the online names to onPlayers', async () => {
    const onPlayers = vi.fn();
    const c = new MetricsCollector(prisma, deps({ onPlayers }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    expect(onPlayers).toHaveBeenCalledWith(['Alice']);
  });
  it('does not call onPlayers when the server is not ready', async () => {
    const onPlayers = vi.fn();
    const c = new MetricsCollector(prisma, deps({ status: () => 'stopped' as const, onPlayers }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    expect(onPlayers).not.toHaveBeenCalled();
  });
```

Run: `pnpm --filter @mc/backend exec vitest run src/metrics/collector.test.ts`
Expected: PASS.

- [ ] **Step 5: Montage des routes**

Dans `packages/backend/src/app.ts`, ajouter les imports :

```ts
import { playersRoutes, bansRoutes, listsRoutes, whitelistRoutes } from './routes/players.routes.js';
import { journalRoutes } from './routes/journal.routes.js';
```

et après `app.use('/api/audit', auditRoutes);` :

```ts
  app.use('/api/players', playersRoutes);
  app.use('/api/bans', bansRoutes);
  app.use('/api/lists', listsRoutes);
  app.use('/api/whitelist', whitelistRoutes);
  app.use('/api/journal', journalRoutes);
```

- [ ] **Step 6: Câblage dans index.ts**

Ajouter les imports :

```ts
import { PlayerJournal } from './players/player-journal.js';
import { PlayerAdmin } from './players/player-admin.js';
```

Après le bloc `wss.on('authenticated', …)` et **avant** `await docker.start();`, insérer :

```ts
  // Journal joueurs : abonné avant docker.start()/logs.start() pour ne manquer aucune ligne.
  app.locals.dataDir = config.mc.dataDir;
  const journal = new PlayerJournal(prisma, config.mc.dataDir);
  await journal.start();
  app.locals.journal = journal;
  logs.on('line', (line, at) => void journal.handleLine(line, at));
  docker.on('status', (s) => void journal.onStatus(s));
  journal.on('session', (e) => broadcast(wss, { type: 'player.session', ...e }));
```

Après `await rcon.start();`, insérer :

```ts
  const playerAdmin = new PlayerAdmin(rcon);
  app.locals.playerAdmin = playerAdmin;
  playerAdmin.on('listsChanged', () => broadcast(wss, { type: 'player.lists.changed' }));
```

Dans les `deps` du `MetricsCollector`, ajouter :

```ts
    onPlayers: (names) => void journal.reconcile(names),
```

Après `metrics.start();`, insérer :

```ts
  // Purge quotidienne du journal selon la rétention configurée.
  void journal.purge();
  const purgeTimer = setInterval(() => void journal.purge(), 86_400_000);
```

Dans `shutdown`, après `metrics.stop();` : `clearInterval(purgeTimer);`.

- [ ] **Step 7: Vérification complète et commit**

Run: `pnpm typecheck && pnpm --filter @mc/backend run test`
Expected: tout vert.

```bash
git add packages/backend/src
git commit -m "feat(lot2a): horodatage des logs Docker, câblage du journal et des commandes joueurs"
```

---

### Task 10: Frontend socle — API, pays, WebSocket, navigation, i18n

**Files:**
- Create: `packages/frontend/src/api/players.api.ts`, `packages/frontend/src/api/journal.api.ts`
- Create: `packages/frontend/src/lib/country.ts`, `packages/frontend/src/components/players/CountryFlag.tsx`
- Modify: `packages/frontend/src/hooks/use-websocket.ts`, `packages/frontend/src/components/layout/Sidebar.tsx`, `packages/frontend/src/App.tsx`
- Create: `packages/frontend/scripts/i18n-fragments/players.json`, `packages/frontend/scripts/i18n-fragments/journal.json`, `packages/frontend/scripts/i18n-fragments/settings-journal.json`
- Modify: `packages/frontend/scripts/i18n-fragments/nav.json`, `packages/frontend/scripts/i18n-fragments/audit.json`, `packages/frontend/src/pages/Audit.tsx:11`
- Test: `packages/frontend/src/lib/country.test.ts`, `packages/frontend/src/hooks/use-websocket.test.ts`

**Interfaces:**
- Produces: `playersApi`, `journalApi` (signatures ci-dessous), `flagEmoji(iso)`, `countryName(iso, lang)`, `<CountryFlag country={string | null} hasIp={boolean} />`, routes `/players`, `/players/:uuid`, `/journal` (pages créées aux tâches 11, 13, 14 ; des composants provisoires sont posés ici), clés i18n `players.*`, `journal.*`, `nav.players`, `nav.journal`, `settings.users.journalRetention.*`, `audit.actions.player`, `audit.actions.whitelist`.

- [ ] **Step 1: Clients API**

Créer `packages/frontend/src/api/players.api.ts` :

```ts
import api from './client';
import type { OnlinePlayer, Page, PlayerSheet, PlayerSummary, ServerLists } from '@mc/common';

export const playersApi = {
  online: (): Promise<Page<OnlinePlayer>> => api.get('/players', { params: { online: 1 } }).then((r) => r.data),
  list: (p: { q?: string; page: number; limit: number }): Promise<Page<PlayerSummary>> => api.get('/players', { params: p }).then((r) => r.data),
  sheet: (uuid: string): Promise<PlayerSheet> => api.get(`/players/${encodeURIComponent(uuid)}`).then((r) => r.data),
  kick: (name: string, reason?: string) => api.post(`/players/${encodeURIComponent(name)}/kick`, { reason }),
  ban: (name: string, reason?: string) => api.post(`/players/${encodeURIComponent(name)}/ban`, { reason }),
  pardon: (name: string) => api.post(`/players/${encodeURIComponent(name)}/pardon`),
  op: (name: string) => api.post(`/players/${encodeURIComponent(name)}/op`),
  deop: (name: string) => api.post(`/players/${encodeURIComponent(name)}/deop`),
  /** Bannit l'IP de la session en cours d'un joueur en ligne (l'IP reste côté serveur). */
  banIp: (name: string, reason?: string) => api.post(`/players/${encodeURIComponent(name)}/ban-ip`, { reason }),
  banIpAddress: (ip: string, reason?: string) => api.post('/bans/ip', { ip, reason }),
  pardonIp: (ip: string) => api.delete(`/bans/ip/${encodeURIComponent(ip)}`),
  lists: (): Promise<ServerLists> => api.get('/lists').then((r) => r.data),
  whitelistAdd: (name: string) => api.post(`/whitelist/${encodeURIComponent(name)}`),
  whitelistRemove: (name: string) => api.delete(`/whitelist/${encodeURIComponent(name)}`),
  whitelistEnabled: (enabled: boolean) => api.put('/whitelist/enabled', { enabled }),
};
```

Créer `packages/frontend/src/api/journal.api.ts` :

```ts
import api from './client';
import type { JournalRetention, Page, PlayerLoginFailureEntry, PlayerSessionEntry, WebLoginEntry } from '@mc/common';

export interface JournalQuery { q?: string; from?: string; to?: string; page: number; limit: number }

export const journalApi = {
  players: (p: JournalQuery): Promise<Page<PlayerSessionEntry>> => api.get('/journal/players', { params: p }).then((r) => r.data),
  failures: (p: JournalQuery): Promise<Page<PlayerLoginFailureEntry>> => api.get('/journal/failures', { params: p }).then((r) => r.data),
  web: (p: JournalQuery): Promise<Page<WebLoginEntry>> => api.get('/journal/web', { params: p }).then((r) => r.data),
  retention: (): Promise<JournalRetention> => api.get('/journal/retention').then((r) => r.data),
  setRetention: (days: number): Promise<JournalRetention> => api.put('/journal/retention', { days }).then((r) => r.data),
};
```

- [ ] **Step 2: Test du helper pays (échec attendu)**

Créer `packages/frontend/src/lib/country.test.ts` :

```ts
import { flagEmoji, countryName } from './country';

describe('country helpers', () => {
  it('builds a regional-indicator flag from an ISO code', () => {
    expect(flagEmoji('FR')).toBe('🇫🇷');
    expect(flagEmoji('us')).toBe('🇺🇸');
  });
  it('returns an empty string for a missing or malformed code', () => {
    expect(flagEmoji(null)).toBe('');
    expect(flagEmoji('FRA')).toBe('');
    expect(flagEmoji('1A')).toBe('');
  });
  it('names a country in the requested language, falling back to the code', () => {
    expect(countryName('FR', 'fr')).toBe('France');
    expect(countryName('FR', 'en')).toBe('France');
    expect(countryName('DE', 'en')).toBe('Germany');
    expect(countryName('ZZ', 'en')).toBe('ZZ');
  });
});
```

Run: `pnpm --filter @mc/frontend exec vitest run src/lib/country.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Helper pays et composant drapeau**

Créer `packages/frontend/src/lib/country.ts` :

```ts
const ISO_RE = /^[A-Za-z]{2}$/;

/** Drapeau en indicateurs régionaux Unicode ; chaîne vide si le code est absent ou mal formé. */
export function flagEmoji(iso: string | null | undefined): string {
  if (!iso || !ISO_RE.test(iso)) return '';
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('');
}

/** Nom du pays dans la langue demandée via Intl.DisplayNames, sinon le code lui-même. */
export function countryName(iso: string, lang: string): string {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'region' }).of(iso.toUpperCase());
    return name && name !== iso.toUpperCase() ? name : iso;
  } catch { return iso; }
}
```

Créer `packages/frontend/src/components/players/CountryFlag.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { flagEmoji, countryName } from '@/lib/country';

/** Drapeau + nom au survol ; « LAN » si une IP est connue sans pays ; rien sans IP. */
export function CountryFlag({ country, hasIp }: { country: string | null | undefined; hasIp: boolean }) {
  const { i18n, t } = useTranslation();
  if (country) return <span title={countryName(country, i18n.language)} aria-label={countryName(country, i18n.language)}>{flagEmoji(country)}</span>;
  if (hasIp) return <Badge variant="secondary" className="text-[10px]">{t('players.lan')}</Badge>;
  return <span className="text-muted-foreground">—</span>;
}
```

Run: `pnpm --filter @mc/frontend exec vitest run src/lib/country.test.ts`
Expected: PASS.

- [ ] **Step 4: Test WebSocket (échec attendu)**

Ajouter dans `packages/frontend/src/hooks/use-websocket.test.ts`, dans le `describe('useWebSocket')` :

```ts
  it('invalidates player queries on player.session and lists on player.lists.changed', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'player.session', kind: 'join', player: { name: 'A', uuid: null, joinedAt: 'x', country: null, hasIp: false } }) }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['players'] });
    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'player.lists.changed' }) }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['lists'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['players'] });
  });
```

Run: `pnpm --filter @mc/frontend exec vitest run src/hooks/use-websocket.test.ts`
Expected: FAIL sur le nouveau test.

- [ ] **Step 5: Hook WebSocket**

Dans `packages/frontend/src/hooks/use-websocket.ts`, dans `socket.onmessage`, après la ligne qui invalide `backups` :

```ts
          if (msg.type === 'player.session') void queryClient.invalidateQueries({ queryKey: ['players'] });
          if (msg.type === 'player.lists.changed') { void queryClient.invalidateQueries({ queryKey: ['lists'] }); void queryClient.invalidateQueries({ queryKey: ['players'] }); }
```

et dans `socket.onopen`, après l'invalidation de `metrics` :

```ts
        void queryClient.invalidateQueries({ queryKey: ['players'] });
        void queryClient.invalidateQueries({ queryKey: ['lists'] });
```

Run: `pnpm --filter @mc/frontend exec vitest run src/hooks/use-websocket.test.ts`
Expected: PASS.

- [ ] **Step 6: Fragments i18n**

Créer `packages/frontend/scripts/i18n-fragments/players.json` :

```json
{ "namespace": "players", "keys": {
  "en": {
    "title": "Players", "tabs": { "online": "Online", "all": "All players", "whitelist": "Whitelist & ops", "bans": "Bans" },
    "lan": "LAN", "unknownCountry": "Unknown", "name": "Name", "since": "Online since", "country": "Country", "lastSeen": "Last seen", "sessions": "Sessions", "status": "Status",
    "noneOnline": "Nobody online", "noneKnown": "No player seen yet", "search": "Search a player",
    "badges": { "online": "online", "op": "op", "whitelisted": "whitelisted", "banned": "banned" },
    "actions": { "kick": "Kick", "ban": "Ban", "banIp": "Ban IP", "op": "Make operator", "deop": "Remove operator", "pardon": "Lift ban", "menu": "Actions" },
    "reason": "Reason (optional)", "confirm": { "kick": "Kick {{name}}?", "ban": "Ban {{name}}?", "banIp": "Ban the IP address of {{name}}?", "op": "Make {{name}} an operator?", "deop": "Remove operator rights from {{name}}?", "pardon": "Lift the ban on {{name}}?", "pardonIp": "Lift the ban on {{ip}}?", "whitelistRemove": "Remove {{name}} from the whitelist?" },
    "done": { "kick": "{{name}} kicked", "ban": "{{name}} banned", "banIp": "IP banned", "op": "{{name}} is now an operator", "deop": "{{name}} is no longer an operator", "pardon": "Ban lifted", "whitelistAdd": "{{name}} added to the whitelist", "whitelistRemove": "{{name}} removed from the whitelist", "whitelistOn": "Whitelist enabled", "whitelistOff": "Whitelist disabled" },
    "rconUnavailable": "Server unreachable: actions disabled",
    "whitelist": { "enabled": "Whitelist enabled", "add": "Add a player", "addButton": "Add", "empty": "Whitelist is empty", "opsTitle": "Operators", "opsEmpty": "No operator", "level": "Level" },
    "bans": { "playersTitle": "Banned players", "ipsTitle": "Banned IP addresses", "empty": "No ban", "reason": "Reason", "created": "Since", "source": "By", "lift": "Lift" },
    "sheet": { "previousNames": "Previously known as", "playTimeObserved": "Observed play time", "playTime": "Play time", "deaths": "Deaths", "playerKills": "Player kills", "mobKills": "Mob kills", "distance": "Distance", "jumps": "Jumps", "damageTaken": "Damage taken", "blocksMined": "Blocks mined", "itemsCrafted": "Items crafted", "noStats": "No statistics yet: the server has not written this player's stats file.", "activity": "Activity over 30 days", "minutes": "min", "recentSessions": "Recent sessions", "joined": "Joined", "left": "Left", "duration": "Duration", "stillOnline": "still online", "notFound": "Player not found", "unknown": "unknown" }
  },
  "fr": {
    "title": "Joueurs", "tabs": { "online": "En ligne", "all": "Tous", "whitelist": "Whitelist et ops", "bans": "Bans" },
    "lan": "LAN", "unknownCountry": "Inconnu", "name": "Nom", "since": "Connecté depuis", "country": "Pays", "lastSeen": "Dernière connexion", "sessions": "Sessions", "status": "Statut",
    "noneOnline": "Personne en ligne", "noneKnown": "Aucun joueur vu pour l'instant", "search": "Rechercher un joueur",
    "badges": { "online": "en ligne", "op": "op", "whitelisted": "whitelisté", "banned": "banni" },
    "actions": { "kick": "Expulser", "ban": "Bannir", "banIp": "Bannir l'IP", "op": "Passer opérateur", "deop": "Retirer opérateur", "pardon": "Lever le ban", "menu": "Actions" },
    "reason": "Raison (optionnelle)", "confirm": { "kick": "Expulser {{name}} ?", "ban": "Bannir {{name}} ?", "banIp": "Bannir l'adresse IP de {{name}} ?", "op": "Passer {{name}} opérateur ?", "deop": "Retirer les droits d'opérateur de {{name}} ?", "pardon": "Lever le ban de {{name}} ?", "pardonIp": "Lever le ban de {{ip}} ?", "whitelistRemove": "Retirer {{name}} de la whitelist ?" },
    "done": { "kick": "{{name}} expulsé", "ban": "{{name}} banni", "banIp": "IP bannie", "op": "{{name}} est maintenant opérateur", "deop": "{{name}} n'est plus opérateur", "pardon": "Ban levé", "whitelistAdd": "{{name}} ajouté à la whitelist", "whitelistRemove": "{{name}} retiré de la whitelist", "whitelistOn": "Whitelist activée", "whitelistOff": "Whitelist désactivée" },
    "rconUnavailable": "Serveur injoignable : actions désactivées",
    "whitelist": { "enabled": "Whitelist activée", "add": "Ajouter un joueur", "addButton": "Ajouter", "empty": "Whitelist vide", "opsTitle": "Opérateurs", "opsEmpty": "Aucun opérateur", "level": "Niveau" },
    "bans": { "playersTitle": "Joueurs bannis", "ipsTitle": "Adresses IP bannies", "empty": "Aucun ban", "reason": "Raison", "created": "Depuis", "source": "Par", "lift": "Lever" },
    "sheet": { "previousNames": "Anciens pseudos", "playTimeObserved": "Temps de jeu observé", "playTime": "Temps de jeu", "deaths": "Morts", "playerKills": "Joueurs tués", "mobKills": "Monstres tués", "distance": "Distance", "jumps": "Sauts", "damageTaken": "Dégâts subis", "blocksMined": "Blocs minés", "itemsCrafted": "Objets fabriqués", "noStats": "Pas encore de statistiques : le serveur n'a pas écrit le fichier de ce joueur.", "activity": "Activité sur 30 jours", "minutes": "min", "recentSessions": "Sessions récentes", "joined": "Arrivée", "left": "Départ", "duration": "Durée", "stillOnline": "toujours en ligne", "notFound": "Joueur introuvable", "unknown": "inconnu" }
  }
} }
```

Créer `packages/frontend/scripts/i18n-fragments/journal.json` :

```json
{ "namespace": "journal", "keys": {
  "en": {
    "title": "Connection journal", "tabs": { "players": "Minecraft", "failures": "Refused", "web": "MC Manager" },
    "when": "When", "name": "Name", "ip": "IP", "country": "Country", "duration": "Duration", "reason": "Reason", "result": "Result", "success": "success", "failure": "failure", "ongoing": "ongoing", "reconciled": "no IP (seen by list)",
    "filterName": "Name", "from": "From", "to": "To", "empty": "No entry",
    "reasons": { "not_whitelisted": "not whitelisted", "banned": "banned", "full": "server full", "other": "other", "bad_password": "wrong password", "disabled": "account disabled", "mfa_failed": "wrong 2FA code", "unknown_user": "unknown user", "trusted_device": "trusted device", "mfa": "2FA" }
  },
  "fr": {
    "title": "Journal de connexions", "tabs": { "players": "Minecraft", "failures": "Refus", "web": "MC Manager" },
    "when": "Quand", "name": "Nom", "ip": "IP", "country": "Pays", "duration": "Durée", "reason": "Raison", "result": "Résultat", "success": "succès", "failure": "échec", "ongoing": "en cours", "reconciled": "sans IP (vu par list)",
    "filterName": "Nom", "from": "Du", "to": "Au", "empty": "Aucune entrée",
    "reasons": { "not_whitelisted": "non whitelisté", "banned": "banni", "full": "serveur plein", "other": "autre", "bad_password": "mauvais mot de passe", "disabled": "compte désactivé", "mfa_failed": "mauvais code 2FA", "unknown_user": "utilisateur inconnu", "trusted_device": "appareil de confiance", "mfa": "2FA" }
  }
} }
```

Créer `packages/frontend/scripts/i18n-fragments/settings-journal.json` (le script fusionne en profondeur dans le namespace `settings` existant) :

```json
{ "namespace": "settings", "keys": {
  "en": { "users": { "journalRetention": { "title": "Connection journal retention", "days": "Retention (days)", "hint": "0 keeps everything. Applies to Minecraft sessions, refused connections and MC Manager logins.", "save": "Save", "saved": "Retention saved", "failed": "Could not save retention" } } },
  "fr": { "users": { "journalRetention": { "title": "Rétention du journal de connexions", "days": "Rétention (jours)", "hint": "0 conserve tout. S'applique aux sessions Minecraft, aux refus et aux connexions à MC Manager.", "save": "Enregistrer", "saved": "Rétention enregistrée", "failed": "Impossible d'enregistrer la rétention" } } }
} }
```

Dans `packages/frontend/scripts/i18n-fragments/nav.json`, ajouter aux deux langues : en `"players": "Players", "journal": "Journal"`, fr `"players": "Joueurs", "journal": "Journal"`.

Dans `packages/frontend/scripts/i18n-fragments/audit.json`, ajouter dans `actions` : en `"player": "Players", "whitelist": "Whitelist", "journal": "Journal"`, fr `"player": "Joueurs", "whitelist": "Whitelist", "journal": "Journal"`.

Puis :

```bash
node packages/frontend/scripts/merge-i18n.mjs
```

Expected: `OK — N keys across 2 locales`.

Dans `packages/frontend/src/pages/Audit.tsx`, remplacer la ligne 11 :

```ts
const ACTIONS = ['', 'server', 'rcon', 'backup', 'user', 'player', 'whitelist', 'journal'];
```

- [ ] **Step 7: Navigation et routes**

Dans `packages/frontend/src/components/layout/Sidebar.tsx` :

- étendre l'import lucide : `import { LayoutDashboard, Terminal, Archive, History, Settings, ChevronLeft, ChevronRight, Users, BookOpenText } from 'lucide-react';`
- remplacer `navSections` par :

```ts
const navSections = [
  { label: 'nav.server', items: [
    { to: '/dashboard', icon: LayoutDashboard, label: 'nav.dashboard' },
    { to: '/console', icon: Terminal, label: 'nav.console' },
    { to: '/players', icon: Users, label: 'nav.players' },
  ] },
  { label: 'nav.data', items: [
    { to: '/backups', icon: Archive, label: 'nav.backups' },
    { to: '/journal', icon: BookOpenText, label: 'nav.journal', adminOnly: true },
    { to: '/audit', icon: History, label: 'nav.audit' },
  ] },
];
```

Dans `packages/frontend/src/App.tsx`, ajouter les imports paresseux et les routes (les pages sont créées aux tâches suivantes ; pour que le typecheck passe dès cette tâche, créer les trois fichiers avec un composant minimal) :

```ts
const Players = lazy(() => import('@/pages/Players'));
const PlayerSheet = lazy(() => import('@/pages/PlayerSheet'));
const Journal = lazy(() => import('@/pages/Journal'));
```

```tsx
              <Route path="/players" element={<Players />} />
              <Route path="/players/:uuid" element={<PlayerSheet />} />
              <Route path="/journal" element={<Journal />} />
```

Composants provisoires, chacun dans son fichier (`pages/Players.tsx`, `pages/PlayerSheet.tsx`, `pages/Journal.tsx`), remplacés aux tâches 11, 13 et 14 :

```tsx
import { useTranslation } from 'react-i18next';
export default function Players() { const { t } = useTranslation(); return <h1 className="text-xl font-semibold">{t('players.title')}</h1>; }
```

(même forme pour `PlayerSheet` avec `players.title` et `Journal` avec `journal.title`).

- [ ] **Step 8: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend run typecheck && pnpm --filter @mc/frontend run test`
Expected: tout vert.

```bash
git add packages/frontend
git commit -m "feat(lot2a): clients API joueurs et journal, drapeaux, navigation, i18n"
```

---

### Task 11: Page Joueurs — onglets En ligne et Tous

**Files:**
- Create: `packages/frontend/src/components/players/ReasonDialog.tsx`, `packages/frontend/src/components/players/PlayerActionsMenu.tsx`, `packages/frontend/src/components/players/OnlineTab.tsx`, `packages/frontend/src/components/players/AllPlayersTab.tsx`
- Modify: `packages/frontend/src/pages/Players.tsx` (remplace le provisoire)
- Test: `packages/frontend/src/components/players/OnlineTab.test.tsx`

**Interfaces:**
- Consumes: `playersApi`, `CountryFlag` (tâche 10), `useAuthStore.isAdmin()`, `useServerStore.info.status`, `ConfirmDialog`, composants UI.
- Produces: `<PlayerActionsMenu name uuid hasIp online op banned />`, `<ReasonDialog open title onConfirm onOpenChange loading />`, `<OnlineTab />`, `<AllPlayersTab />`, page `Players` avec quatre onglets (`WhitelistTab` et `BansTab` arrivent en tâche 12 : les importer dès maintenant depuis des fichiers provisoires `WhitelistTab.tsx` et `BansTab.tsx` qui rendent `null`).

- [ ] **Step 1: Test de l'onglet En ligne (échec attendu)**

Créer `packages/frontend/src/components/players/OnlineTab.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { playersApi } from '@/api/players.api';
import { OnlineTab } from './OnlineTab';
import { toast } from 'sonner';

// Les menus Radix s'ouvrent au pointeur, pas au click synthétique : userEvent est requis.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/players.api', () => ({ playersApi: { online: vi.fn(), kick: vi.fn().mockResolvedValue({}), ban: vi.fn().mockResolvedValue({}), banIp: vi.fn(), op: vi.fn().mockResolvedValue({}), deop: vi.fn(), pardon: vi.fn() } }));

const alice = { name: 'Alice', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', joinedAt: '2026-10-10T10:00:00Z', country: 'FR', hasIp: true };
const bob = { name: 'Bob', uuid: null, joinedAt: '2026-10-10T10:05:00Z', country: null, hasIp: false };

function setup(role: 'admin' | 'viewer', status: 'ready' | 'stopped' = 'ready') {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: { status, containerName: 'mc' } as never });
  vi.mocked(playersApi.online).mockResolvedValue({ items: [alice, bob], total: 2, page: 1, limit: 2 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><OnlineTab /></MemoryRouter></QueryClientProvider>);
}

describe('OnlineTab', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('lists online players with their flag or LAN chip and links to the sheet', async () => {
    setup('viewer');
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByLabelText('France')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alice/ })).toHaveAttribute('href', `/players/${alice.uuid}`);
    expect(screen.queryByRole('link', { name: /Bob/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('admin kicks with a reason after confirmation', async () => {
    const u = user();
    setup('admin');
    await screen.findByText('Alice');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Kick' }));
    fireEvent.change(await screen.findByLabelText('Reason (optional)'), { target: { value: 'afk' } });
    await u.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(playersApi.kick).toHaveBeenCalledWith('Alice', 'afk'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alice kicked'));
  });

  it('ban IP is disabled for a player without ip', async () => {
    const u = user();
    setup('admin');
    await screen.findByText('Bob');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    expect(await screen.findByRole('menuitem', { name: 'Ban IP' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('actions are disabled when the server is not ready', async () => {
    setup('admin', 'stopped');
    await screen.findByText('Alice');
    expect(screen.getAllByRole('button', { name: 'Actions' })[0]).toBeDisabled();
  });

  it('shows the server error on failure', async () => {
    const u = user();
    vi.mocked(playersApi.op).mockRejectedValueOnce({ response: { status: 409, data: { error: 'Nothing changed' } } });
    setup('admin');
    await screen.findByText('Alice');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Make operator' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nothing changed'));
  });
});
```

Run: `pnpm --filter @mc/frontend exec vitest run src/components/players/OnlineTab.test.tsx`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Dialogue de raison**

Créer `packages/frontend/src/components/players/ReasonDialog.tsx` :

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props { open: boolean; onOpenChange: (o: boolean) => void; title: string; withReason?: boolean; destructive?: boolean; loading?: boolean; onConfirm: (reason?: string) => void }

/** Confirmation d'une action joueur, avec champ raison optionnel (kick, ban, ban IP). */
export function ReasonDialog({ open, onOpenChange, title, withReason, destructive, loading, onConfirm }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setReason(''); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription className="sr-only">{title}</DialogDescription></DialogHeader>
        {withReason && (
          <div className="space-y-1.5">
            <Label htmlFor="player-action-reason">{t('players.reason')}</Label>
            <Input id="player-action-reason" value={reason} maxLength={100} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{t('shared.cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={loading} onClick={() => onConfirm(reason.trim() || undefined)}>{loading ? t('shared.processing') : t('shared.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Menu d'actions**

Créer `packages/frontend/src/components/players/PlayerActionsMenu.tsx` :

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { playersApi } from '@/api/players.api';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ReasonDialog } from './ReasonDialog';

type Action = 'kick' | 'ban' | 'banIp' | 'op' | 'deop' | 'pardon';
interface Props { name: string; hasIp?: boolean; online?: boolean; op?: boolean; banned?: boolean }

export const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback;

/** Menu kick / ban / ban IP / op / deop / pardon ; désactivé quand le serveur n'est pas prêt. */
export function PlayerActionsMenu({ name, hasIp = false, online = false, op = false, banned = false }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useServerStore((s) => s.info?.status);
  const ready = status === 'ready' || status === 'unhealthy';
  const [pending, setPending] = useState<Action | null>(null);
  const run = useMutation({
    mutationFn: async ({ action, reason }: { action: Action; reason?: string }) => {
      switch (action) {
        case 'kick': return playersApi.kick(name, reason);
        case 'ban': return playersApi.ban(name, reason);
        case 'banIp': return playersApi.banIp(name, reason);
        case 'op': return playersApi.op(name);
        case 'deop': return playersApi.deop(name);
        case 'pardon': return playersApi.pardon(name);
      }
    },
    onSuccess: (_d, v) => { toast.success(t(`players.done.${v.action}`, { name })); void qc.invalidateQueries({ queryKey: ['players'] }); void qc.invalidateQueries({ queryKey: ['lists'] }); setPending(null); },
    onError: (e) => { toast.error(errMsg(e, t('shared.error'))); setPending(null); },
  });
  const items: { action: Action; show: boolean; disabled?: boolean; destructive?: boolean }[] = [
    { action: 'kick', show: online, destructive: true },
    { action: 'ban', show: !banned, destructive: true },
    { action: 'banIp', show: online, disabled: !hasIp, destructive: true },
    { action: 'pardon', show: banned },
    { action: 'op', show: !op },
    { action: 'deop', show: op },
  ];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t('players.actions.menu')} disabled={!ready} title={ready ? undefined : t('players.rconUnavailable')}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.filter((i) => i.show).map((i, idx, arr) => (
            <div key={i.action}>
              <DropdownMenuItem disabled={i.disabled} className={i.destructive ? 'text-destructive' : undefined} onSelect={() => setPending(i.action)}>{t(`players.actions.${i.action}`)}</DropdownMenuItem>
              {i.destructive && arr[idx + 1] && !arr[idx + 1].destructive && <DropdownMenuSeparator />}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReasonDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} title={pending ? t(`players.confirm.${pending}`, { name }) : ''}
        withReason={pending === 'kick' || pending === 'ban' || pending === 'banIp'} destructive={pending === 'kick' || pending === 'ban' || pending === 'banIp'}
        loading={run.isPending} onConfirm={(reason) => pending && run.mutate({ action: pending, reason })} />
    </>
  );
}
```

Note : `banIp` bannit l'IP de la session en cours du joueur via `POST /api/players/:name/ban-ip` (tâche 7) : le navigateur ne connaît jamais l'IP, seul `hasIp` lui dit si l'action est possible.

- [ ] **Step 4: Onglets En ligne et Tous**

Créer `packages/frontend/src/components/players/OnlineTab.tsx` :

```tsx
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { CountryFlag } from './CountryFlag';
import { PlayerActionsMenu } from './PlayerActionsMenu';

export function PlayerName({ name, uuid }: { name: string; uuid: string | null }) {
  const inner = <><img src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/16`} alt="" className="h-4 w-4 rounded-sm" loading="lazy" /><span>{name}</span></>;
  return uuid ? <Link to={`/players/${uuid}`} className="flex items-center gap-2 hover:underline">{inner}</Link> : <span className="flex items-center gap-2">{inner}</span>;
}

export function OnlineTab() {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data } = useQuery({ queryKey: ['players', 'online'], queryFn: playersApi.online });
  const items = data?.items ?? [];
  if (data && items.length === 0) return <EmptyState title={t('players.noneOnline')} />;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.name')}</th><th>{t('players.since')}</th><th>{t('players.country')}</th>{isAdmin && <th className="w-12" />}</tr></thead>
      <tbody>{items.map((p) => (
        <tr key={p.name} className="border-t">
          <td className="py-2"><PlayerName name={p.name} uuid={p.uuid} /></td>
          <td>{new Date(p.joinedAt).toLocaleString(i18n.language)}</td>
          <td><CountryFlag country={p.country} hasIp={p.hasIp} /></td>
          {isAdmin && <td className="text-right"><PlayerActionsMenu name={p.name} hasIp={p.hasIp} online /></td>}
        </tr>
      ))}</tbody>
    </table>
  );
}
```

Créer `packages/frontend/src/components/players/AllPlayersTab.tsx` :

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { PlayerName } from './OnlineTab';
import { PlayerActionsMenu } from './PlayerActionsMenu';

export function AllPlayersTab() {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;
  const { data } = useQuery({ queryKey: ['players', 'all', q, page], queryFn: () => playersApi.list({ q: q || undefined, page, limit }) });
  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  return (
    <div className="space-y-3">
      <Input className="h-8 max-w-xs" placeholder={t('players.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {data && data.items.length === 0 ? <EmptyState title={t('players.noneKnown')} /> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.name')}</th><th>{t('players.status')}</th><th>{t('players.lastSeen')}</th><th>{t('players.sessions')}</th>{isAdmin && <th className="w-12" />}</tr></thead>
          <tbody>{(data?.items ?? []).map((p) => (
            <tr key={p.uuid ?? p.name} className="border-t">
              <td className="py-2"><PlayerName name={p.name} uuid={p.uuid} /></td>
              <td className="space-x-1">
                {p.online && <Badge variant="success">{t('players.badges.online')}</Badge>}
                {p.op && <Badge>{t('players.badges.op')}</Badge>}
                {p.whitelisted && <Badge variant="secondary">{t('players.badges.whitelisted')}</Badge>}
                {p.banned && <Badge variant="destructive">{t('players.badges.banned')}</Badge>}
              </td>
              <td>{new Date(p.lastSeenAt).toLocaleString(i18n.language)}</td>
              <td className="font-mono text-xs">{p.sessionCount}</td>
              {isAdmin && <td className="text-right"><PlayerActionsMenu name={p.name} online={p.online} op={p.op} banned={p.banned} /></td>}
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="flex items-center justify-end gap-2 text-xs">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
        <span>{page} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
      </div>
    </div>
  );
}
```

Créer les provisoires `WhitelistTab.tsx` et `BansTab.tsx` dans le même dossier :

```tsx
export function WhitelistTab() { return null; }
```

```tsx
export function BansTab() { return null; }
```

Remplacer `packages/frontend/src/pages/Players.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OnlineTab } from '@/components/players/OnlineTab';
import { AllPlayersTab } from '@/components/players/AllPlayersTab';
import { WhitelistTab } from '@/components/players/WhitelistTab';
import { BansTab } from '@/components/players/BansTab';

export default function Players() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('players.title')}</h1>
      <Tabs defaultValue="online">
        <TabsList>
          <TabsTrigger value="online">{t('players.tabs.online')}</TabsTrigger>
          <TabsTrigger value="all">{t('players.tabs.all')}</TabsTrigger>
          <TabsTrigger value="whitelist">{t('players.tabs.whitelist')}</TabsTrigger>
          <TabsTrigger value="bans">{t('players.tabs.bans')}</TabsTrigger>
        </TabsList>
        <Card className="mt-4"><CardContent className="p-4">
          <TabsContent value="online" className="mt-0"><OnlineTab /></TabsContent>
          <TabsContent value="all" className="mt-0"><AllPlayersTab /></TabsContent>
          <TabsContent value="whitelist" className="mt-0"><WhitelistTab /></TabsContent>
          <TabsContent value="bans" className="mt-0"><BansTab /></TabsContent>
        </CardContent></Card>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/players && pnpm --filter @mc/frontend run typecheck`
Expected: PASS.

```bash
git add packages/frontend
git commit -m "feat(lot2a): page Joueurs, onglets En ligne et Tous, menu d'actions"
```

---

### Task 12: Onglets Whitelist et ops, Bans

**Files:**
- Modify: `packages/frontend/src/components/players/WhitelistTab.tsx`, `packages/frontend/src/components/players/BansTab.tsx` (remplacent les provisoires)
- Test: `packages/frontend/src/components/players/BansTab.test.tsx`

**Interfaces:**
- Consumes: `playersApi.lists / whitelistAdd / whitelistRemove / whitelistEnabled / pardon / pardonIp`, query key `['lists']`, `errMsg` (tâche 11), `ConfirmDialog`.

- [ ] **Step 1: Test des bans (échec attendu)**

Créer `packages/frontend/src/components/players/BansTab.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { playersApi } from '@/api/players.api';
import { BansTab } from './BansTab';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/players.api', () => ({ playersApi: { lists: vi.fn(), pardon: vi.fn().mockResolvedValue({}), pardonIp: vi.fn().mockResolvedValue({}) } }));

function setup(role: 'admin' | 'viewer') {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
  vi.mocked(playersApi.lists).mockResolvedValue({ whitelist: [], ops: [], whitelistEnabled: false,
    bannedPlayers: [{ uuid: 'x', name: 'Mallory', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: 'griefing' }],
    bannedIps: [{ ip: '198.51.100.7', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: '' }] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BansTab /></QueryClientProvider>);
}

describe('BansTab', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  it('viewer sees both lists without lift buttons', async () => {
    setup('viewer');
    expect(await screen.findByText('Mallory')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.7')).toBeInTheDocument();
    expect(screen.getByText('griefing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lift' })).not.toBeInTheDocument();
  });
  it('admin lifts a player ban and an ip ban after confirmation', async () => {
    setup('admin');
    await screen.findByText('Mallory');
    const buttons = screen.getAllByRole('button', { name: 'Lift' });
    fireEvent.click(buttons[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(playersApi.pardon).toHaveBeenCalledWith('Mallory'));
    fireEvent.click(buttons[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(playersApi.pardonIp).toHaveBeenCalledWith('198.51.100.7'));
  });
});
```

Run: `pnpm --filter @mc/frontend exec vitest run src/components/players/BansTab.test.tsx`
Expected: FAIL (le provisoire rend `null`).

- [ ] **Step 2: Onglet Bans**

Remplacer `packages/frontend/src/components/players/BansTab.tsx` :

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { errMsg } from './PlayerActionsMenu';

type Target = { kind: 'player'; name: string } | { kind: 'ip'; ip: string };

export function BansTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const status = useServerStore((s) => s.info?.status);
  const ready = status === 'ready' || status === 'unhealthy';
  const { data } = useQuery({ queryKey: ['lists'], queryFn: playersApi.lists });
  const [target, setTarget] = useState<Target | null>(null);
  const lift = useMutation({
    mutationFn: (tg: Target) => (tg.kind === 'player' ? playersApi.pardon(tg.name) : playersApi.pardonIp(tg.ip)),
    onSuccess: () => { toast.success(t('players.done.pardon')); void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['players'] }); setTarget(null); },
    onError: (e) => { toast.error(errMsg(e, t('shared.error'))); setTarget(null); },
  });
  const fmt = (s: string) => { const d = new Date(s.replace(/ \+(\d{2})(\d{2})$/, '+$1:$2').replace(' ', 'T')); return Number.isNaN(d.getTime()) ? s : d.toLocaleString(i18n.language); };
  if (!data) return null;
  const empty = data.bannedPlayers.length === 0 && data.bannedIps.length === 0;
  return (
    <div className="space-y-6">
      {empty && <EmptyState title={t('players.bans.empty')} />}
      {data.bannedPlayers.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">{t('players.bans.playersTitle')}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.name')}</th><th>{t('players.bans.reason')}</th><th>{t('players.bans.created')}</th><th>{t('players.bans.source')}</th>{isAdmin && <th className="w-20" />}</tr></thead>
            <tbody>{data.bannedPlayers.map((b) => (
              <tr key={b.uuid || b.name} className="border-t"><td className="py-2">{b.name}</td><td>{b.reason}</td><td>{fmt(b.created)}</td><td className="text-muted-foreground">{b.source}</td>
                {isAdmin && <td className="text-right"><Button size="sm" variant="outline" disabled={!ready} onClick={() => setTarget({ kind: 'player', name: b.name })}>{t('players.bans.lift')}</Button></td>}</tr>
            ))}</tbody>
          </table>
        </section>
      )}
      {data.bannedIps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">{t('players.bans.ipsTitle')}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">IP</th><th>{t('players.bans.reason')}</th><th>{t('players.bans.created')}</th><th>{t('players.bans.source')}</th>{isAdmin && <th className="w-20" />}</tr></thead>
            <tbody>{data.bannedIps.map((b) => (
              <tr key={b.ip} className="border-t"><td className="py-2 font-mono text-xs">{b.ip}</td><td>{b.reason}</td><td>{fmt(b.created)}</td><td className="text-muted-foreground">{b.source}</td>
                {isAdmin && <td className="text-right"><Button size="sm" variant="outline" disabled={!ready} onClick={() => setTarget({ kind: 'ip', ip: b.ip })}>{t('players.bans.lift')}</Button></td>}</tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <ConfirmDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)} loading={lift.isPending}
        title={target?.kind === 'player' ? t('players.confirm.pardon', { name: target.name }) : t('players.confirm.pardonIp', { ip: target?.kind === 'ip' ? target.ip : '' })}
        description="" onConfirm={() => target && lift.mutate(target)} />
    </div>
  );
}
```

- [ ] **Step 3: Onglet Whitelist et ops**

Remplacer `packages/frontend/src/components/players/WhitelistTab.tsx` :

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { errMsg } from './PlayerActionsMenu';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function WhitelistTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const status = useServerStore((s) => s.info?.status);
  const ready = status === 'ready' || status === 'unhealthy';
  const { data } = useQuery({ queryKey: ['lists'], queryFn: playersApi.lists });
  const [name, setName] = useState('');
  const [toRemove, setToRemove] = useState<string | null>(null);
  const [toDeop, setToDeop] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['players'] }); };
  const fail = (e: unknown) => toast.error(errMsg(e, t('shared.error')));
  const toggle = useMutation({ mutationFn: (on: boolean) => playersApi.whitelistEnabled(on), onSuccess: (_d, on) => { toast.success(t(on ? 'players.done.whitelistOn' : 'players.done.whitelistOff')); refresh(); }, onError: fail });
  const add = useMutation({ mutationFn: (n: string) => playersApi.whitelistAdd(n), onSuccess: (_d, n) => { toast.success(t('players.done.whitelistAdd', { name: n })); setName(''); refresh(); }, onError: fail });
  const remove = useMutation({ mutationFn: (n: string) => playersApi.whitelistRemove(n), onSuccess: (_d, n) => { toast.success(t('players.done.whitelistRemove', { name: n })); setToRemove(null); refresh(); }, onError: (e) => { fail(e); setToRemove(null); } });
  const deop = useMutation({ mutationFn: (n: string) => playersApi.deop(n), onSuccess: (_d, n) => { toast.success(t('players.done.deop', { name: n })); setToDeop(null); refresh(); }, onError: (e) => { fail(e); setToDeop(null); } });
  if (!data) return null;
  const canAct = isAdmin && ready;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch id="whitelist-enabled" checked={data.whitelistEnabled} disabled={!canAct || toggle.isPending} onCheckedChange={(on) => toggle.mutate(on)} />
          <Label htmlFor="whitelist-enabled">{t('players.whitelist.enabled')}</Label>
        </div>
        {isAdmin && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (NAME_RE.test(name)) add.mutate(name); }}>
            <Input className="h-8 max-w-xs" placeholder={t('players.whitelist.add')} value={name} onChange={(e) => setName(e.target.value)} disabled={!ready} />
            <Button type="submit" size="sm" disabled={!canAct || !NAME_RE.test(name) || add.isPending}>{t('players.whitelist.addButton')}</Button>
          </form>
        )}
        {data.whitelist.length === 0 ? <EmptyState title={t('players.whitelist.empty')} className="py-6" /> : (
          <ul className="divide-y rounded-md border">{data.whitelist.map((w) => (
            <li key={w.uuid} className="flex items-center justify-between px-3 py-2 text-sm"><span>{w.name}</span>
              {isAdmin && <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setToRemove(w.name)}>✕</Button>}</li>
          ))}</ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t('players.whitelist.opsTitle')}</h2>
        {data.ops.length === 0 ? <EmptyState title={t('players.whitelist.opsEmpty')} className="py-6" /> : (
          <ul className="divide-y rounded-md border">{data.ops.map((o) => (
            <li key={o.uuid} className="flex items-center justify-between px-3 py-2 text-sm"><span>{o.name} <span className="text-xs text-muted-foreground">{t('players.whitelist.level')} {o.level}</span></span>
              {isAdmin && <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setToDeop(o.name)}>{t('players.actions.deop')}</Button>}</li>
          ))}</ul>
        )}
      </section>
      <ConfirmDialog open={toRemove !== null} onOpenChange={(o) => !o && setToRemove(null)} title={t('players.confirm.whitelistRemove', { name: toRemove })} description="" loading={remove.isPending} onConfirm={() => toRemove && remove.mutate(toRemove)} />
      <ConfirmDialog open={toDeop !== null} onOpenChange={(o) => !o && setToDeop(null)} title={t('players.confirm.deop', { name: toDeop })} description="" loading={deop.isPending} onConfirm={() => toDeop && deop.mutate(toDeop)} />
    </div>
  );
}
```

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/players && pnpm --filter @mc/frontend run typecheck`
Expected: PASS.

```bash
git add packages/frontend/src/components/players
git commit -m "feat(lot2a): onglets whitelist, opérateurs et bans"
```

---

### Task 13: Fiche joueur et lien depuis le dashboard

**Files:**
- Modify: `packages/frontend/src/pages/PlayerSheet.tsx` (remplace le provisoire), `packages/frontend/src/components/dashboard/PlayersCard.tsx`
- Test: `packages/frontend/src/pages/PlayerSheet.test.tsx`

**Interfaces:**
- Consumes: `playersApi.sheet`, `CountryFlag`, `PlayerActionsMenu`, `formatDuration` (`lib/utils.ts`), `recharts`.

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/frontend/src/pages/PlayerSheet.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { playersApi } from '@/api/players.api';
import PlayerSheet from './PlayerSheet';

vi.mock('@/api/players.api', () => ({ playersApi: { sheet: vi.fn() } }));
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const base = { uuid: UUID, name: 'Alice', previousNames: ['OldAlice'], online: true, op: true, whitelisted: false, banned: false, lastSeenAt: '2026-10-10T10:00:00Z', sessionCount: 3, playTimeObservedSeconds: 5400,
  sessions: [{ id: 1, uuid: UUID, name: 'Alice', source: 'log' as const, joinedAt: '2026-10-10T09:00:00Z', leftAt: '2026-10-10T10:00:00Z', ip: '8.8.8.8', country: 'US' }],
  daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(11 + i).padStart(2, '0')}`, minutes: i })), stats: null };

function setup(role: 'admin' | 'viewer', sheet = base) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(playersApi.sheet).mockResolvedValue(sheet);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/players/${UUID}`]}><Routes><Route path="/players/:uuid" element={<PlayerSheet />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('PlayerSheet', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  it('shows identity, badges, observed play time and the no-stats message', async () => {
    setup('viewer');
    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText(/OldAlice/)).toBeInTheDocument();
    expect(screen.getByText('op')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText(/No statistics yet/)).toBeInTheDocument();
    expect(screen.queryByText('8.8.8.8')).not.toBeInTheDocument();
  });
  it('admin sees ip and country in sessions and stats tiles when present', async () => {
    setup('admin', { ...base, stats: { playTimeSeconds: 7200, deaths: 4, playerKills: null, mobKills: 10, distanceMeters: 12345, jumps: 1, damageTaken: 2, blocksMined: 3, itemsCrafted: 5 } });
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.getByText('8.8.8.8')).toBeInTheDocument();
    expect(screen.getByText('2h 0m')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('12.3 km')).toBeInTheDocument();
  });
  it('shows not found on 404', async () => {
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'viewer' } });
    vi.mocked(playersApi.sheet).mockRejectedValue({ response: { status: 404 } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/players/${UUID}`]}><Routes><Route path="/players/:uuid" element={<PlayerSheet />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Player not found')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/PlayerSheet.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Page fiche**

Remplacer `packages/frontend/src/pages/PlayerSheet.tsx` :

```tsx
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Clock, Skull, Swords, Footprints, ArrowUp, HeartCrack, Pickaxe, Hammer, Crosshair } from 'lucide-react';
import type { VanillaStats } from '@mc/common';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { CountryFlag } from '@/components/players/CountryFlag';
import { PlayerActionsMenu } from '@/components/players/PlayerActionsMenu';
import { formatDuration } from '@/lib/utils';

const hm = (seconds: number) => { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); return `${h}h ${m}m`; };
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export default function PlayerSheet() {
  const { uuid = '' } = useParams();
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data, error, isLoading } = useQuery({ queryKey: ['players', 'sheet', uuid], queryFn: () => playersApi.sheet(uuid) });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <EmptyState title={t('players.sheet.notFound')} />;
  const s = data.stats;
  const tiles: { icon: typeof Clock; key: keyof VanillaStats; label: string; fmt: (v: number) => string }[] = [
    { icon: Clock, key: 'playTimeSeconds', label: t('players.sheet.playTime'), fmt: hm },
    { icon: Skull, key: 'deaths', label: t('players.sheet.deaths'), fmt: String },
    { icon: Crosshair, key: 'playerKills', label: t('players.sheet.playerKills'), fmt: String },
    { icon: Swords, key: 'mobKills', label: t('players.sheet.mobKills'), fmt: String },
    { icon: Footprints, key: 'distanceMeters', label: t('players.sheet.distance'), fmt: km },
    { icon: ArrowUp, key: 'jumps', label: t('players.sheet.jumps'), fmt: String },
    { icon: HeartCrack, key: 'damageTaken', label: t('players.sheet.damageTaken'), fmt: String },
    { icon: Pickaxe, key: 'blocksMined', label: t('players.sheet.blocksMined'), fmt: String },
    { icon: Hammer, key: 'itemsCrafted', label: t('players.sheet.itemsCrafted'), fmt: String },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <img src={`https://mc-heads.net/avatar/${encodeURIComponent(data.name)}/48`} alt="" className="h-12 w-12 rounded-md" />
        <div>
          <h1 className="text-xl font-semibold">{data.name}</h1>
          {data.previousNames.length > 0 && <p className="text-xs text-muted-foreground">{t('players.sheet.previousNames')} : {data.previousNames.join(', ')}</p>}
        </div>
        <div className="flex gap-1">
          {data.online && <Badge variant="success">{t('players.badges.online')}</Badge>}
          {data.op && <Badge>{t('players.badges.op')}</Badge>}
          {data.whitelisted && <Badge variant="secondary">{t('players.badges.whitelisted')}</Badge>}
          {data.banned && <Badge variant="destructive">{t('players.badges.banned')}</Badge>}
        </div>
        {isAdmin && <div className="ml-auto"><PlayerActionsMenu name={data.name} online={data.online} op={data.op} banned={data.banned} hasIp={data.sessions[0]?.ip != null} /></div>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('players.sheet.playTimeObserved')}</p><p className="font-mono text-lg font-semibold">{hm(data.playTimeObservedSeconds)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('players.sessions')}</p><p className="font-mono text-lg font-semibold">{data.sessionCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{t('players.lastSeen')}</p><p className="font-mono text-lg font-semibold">{data.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString(i18n.language) : '—'}</p></CardContent></Card>
      </div>
      {s ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {tiles.map((tile) => { const v = s[tile.key]; return (
            <Card key={tile.key}><CardContent className="flex items-center gap-3 p-4"><tile.icon className="h-5 w-5 text-primary" />
              <div><p className="text-xs text-muted-foreground">{tile.label}</p><p className="font-mono text-lg font-semibold">{v == null ? t('players.sheet.unknown') : tile.fmt(v)}</p></div></CardContent></Card>
          ); })}
        </div>
      ) : <p className="text-sm text-muted-foreground">{t('players.sheet.noStats')}</p>}
      <Card>
        <CardHeader><CardTitle className="text-sm">{t('players.sheet.activity')}</CardTitle></CardHeader>
        <CardContent className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tickFormatter={(d) => new Date(String(d)).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit' })} minTickGap={30} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={11} width={32} />
              <Tooltip formatter={(v) => [`${v ?? 0} ${t('players.sheet.minutes')}`, '']} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
              <Bar dataKey="minutes" fill="hsl(var(--chart-1))" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">{t('players.sheet.recentSessions')}</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.sheet.joined')}</th><th>{t('players.sheet.duration')}</th>{isAdmin && <><th>IP</th><th>{t('players.country')}</th></>}</tr></thead>
            <tbody>{data.sessions.map((se) => (
              <tr key={se.id} className="border-t">
                <td className="py-2">{new Date(se.joinedAt).toLocaleString(i18n.language)}</td>
                <td>{se.leftAt ? formatDuration(Math.max(60, Math.round((new Date(se.leftAt).getTime() - new Date(se.joinedAt).getTime()) / 1000))) : t('players.sheet.stillOnline')}</td>
                {isAdmin && <><td className="font-mono text-xs">{se.ip ?? '—'}</td><td><CountryFlag country={se.country} hasIp={se.ip != null} /></td></>}
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Carte du dashboard cliquable**

Remplacer `packages/frontend/src/components/dashboard/PlayersCard.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { playersApi } from '@/api/players.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';

/** Noms depuis le tick métriques (lot 1) ; les UUID viennent du journal pour rendre chaque joueur cliquable. */
export function PlayersCard({ names }: { names: string[] }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['players', 'online'], queryFn: playersApi.online, enabled: names.length > 0 });
  const uuidOf = (n: string) => data?.items.find((p) => p.name === n)?.uuid ?? null;
  return (
    <Card><CardHeader><CardTitle className="text-sm">{t('dashboard.onlinePlayers')}</CardTitle></CardHeader>
      <CardContent>{names.length === 0 ? <EmptyState title={t('dashboard.noPlayers')} /> : (
        <ul className="flex flex-wrap gap-2">{names.map((n) => {
          const uuid = uuidOf(n);
          const body = <><img src={`https://mc-heads.net/avatar/${encodeURIComponent(n)}/16`} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />{n}</>;
          return <li key={n} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">{uuid ? <Link to={`/players/${uuid}`} className="flex items-center gap-2 hover:underline">{body}</Link> : body}</li>;
        })}</ul>
      )}</CardContent></Card>
  );
}
```

Si un test existant du dashboard rend `PlayersCard` sans `QueryClientProvider` ni routeur, l'envelopper dans les deux (c'est une adaptation de harnais, pas un changement de comportement).

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck`
Expected: PASS.

```bash
git add packages/frontend/src
git commit -m "feat(lot2a): fiche joueur avec stats vanilla et activité, dashboard cliquable"
```

---

### Task 14: Page Journal et réglage de rétention

**Files:**
- Modify: `packages/frontend/src/pages/Journal.tsx` (remplace le provisoire), `packages/frontend/src/pages/Settings.tsx` (ajout de la carte dans `UsersTab`)
- Create: `packages/frontend/src/components/settings/JournalRetentionCard.tsx`
- Test: `packages/frontend/src/pages/Journal.test.tsx`

**Interfaces:**
- Consumes: `journalApi` (tâche 10), `CountryFlag`, `formatDuration`.

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/frontend/src/pages/Journal.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { journalApi } from '@/api/journal.api';
import Journal from './Journal';

vi.mock('@/api/journal.api', () => ({ journalApi: { players: vi.fn(), failures: vi.fn(), web: vi.fn() } }));

function setup() {
  vi.mocked(journalApi.players).mockResolvedValue({ total: 1, page: 1, limit: 50, items: [{ id: 1, uuid: null, name: 'Alice', source: 'log', joinedAt: '2026-10-10T09:00:00Z', leftAt: '2026-10-10T10:30:00Z', ip: '8.8.8.8', country: 'US' }] });
  vi.mocked(journalApi.failures).mockResolvedValue({ total: 1, page: 1, limit: 50, items: [{ id: 1, name: 'Mallory', ip: '198.51.100.7', country: null, reason: 'banned', message: 'You are banned', createdAt: '2026-10-10T09:00:00Z' }] });
  vi.mocked(journalApi.web).mockResolvedValue({ total: 1, page: 1, limit: 50, items: [{ id: 1, username: 'nobody', userId: null, ip: '1.2.3.4', country: 'FR', success: false, reason: 'unknown_user', createdAt: '2026-10-10T09:00:00Z' }] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Journal /></QueryClientProvider>);
}

describe('Journal page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  it('shows Minecraft sessions with ip, flag and duration, and filters by name', async () => {
    setup();
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('8.8.8.8')).toBeInTheDocument();
    expect(screen.getByLabelText('United States')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'ali' } });
    await waitFor(() => expect(journalApi.players).toHaveBeenCalledWith(expect.objectContaining({ q: 'ali', page: 1 })));
  });
  it('switches to refusals and web logins', async () => {
    setup();
    await screen.findByText('Alice');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Refused' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Refused' }));
    expect(await screen.findByText('Mallory')).toBeInTheDocument();
    expect(screen.getByText('banned')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'MC Manager' }));
    fireEvent.click(screen.getByRole('tab', { name: 'MC Manager' }));
    expect(await screen.findByText('nobody')).toBeInTheDocument();
    expect(screen.getByText('unknown user')).toBeInTheDocument();
    expect(screen.getByText('failure')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Journal.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Page Journal**

Remplacer `packages/frontend/src/pages/Journal.tsx` :

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { journalApi, type JournalQuery } from '@/api/journal.api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { CountryFlag } from '@/components/players/CountryFlag';
import { formatDuration } from '@/lib/utils';

type Tab = 'players' | 'failures' | 'web';
const LIMIT = 50;

export default function Journal() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('players');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const params: JournalQuery = { q: q || undefined, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, page, limit: LIMIT };
  const players = useQuery({ queryKey: ['journal', 'players', params], queryFn: () => journalApi.players(params), enabled: tab === 'players' });
  const failures = useQuery({ queryKey: ['journal', 'failures', params], queryFn: () => journalApi.failures(params), enabled: tab === 'failures' });
  const web = useQuery({ queryKey: ['journal', 'web', params], queryFn: () => journalApi.web(params), enabled: tab === 'web' });
  const total = (tab === 'players' ? players.data : tab === 'failures' ? failures.data : web.data)?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const fmt = (iso: string) => new Date(iso).toLocaleString(i18n.language);
  const duration = (joined: string, left: string | null) => (left ? formatDuration(Math.max(60, Math.round((new Date(left).getTime() - new Date(joined).getTime()) / 1000))) : t('journal.ongoing'));
  const reset = () => setPage(1);
  const empty = <EmptyState title={t('journal.empty')} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">{t('journal.title')}</h1>
        <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); reset(); }} className="ml-4"><TabsList>
          <TabsTrigger value="players">{t('journal.tabs.players')}</TabsTrigger><TabsTrigger value="failures">{t('journal.tabs.failures')}</TabsTrigger><TabsTrigger value="web">{t('journal.tabs.web')}</TabsTrigger>
        </TabsList></Tabs>
        <div className="ml-auto flex flex-wrap gap-2">
          <Input className="h-8 w-36" placeholder={t('journal.filterName')} value={q} onChange={(e) => { setQ(e.target.value); reset(); }} />
          <Input className="h-8 w-36" type="date" aria-label={t('journal.from')} value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          <Input className="h-8 w-36" type="date" aria-label={t('journal.to')} value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
        </div>
      </div>
      <Card><CardContent className="p-4">
        {tab === 'players' && (players.data?.items.length === 0 ? empty : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('journal.when')}</th><th>{t('journal.name')}</th><th>{t('journal.ip')}</th><th>{t('journal.country')}</th><th>{t('journal.duration')}</th></tr></thead>
            <tbody>{(players.data?.items ?? []).map((s) => (
              <tr key={s.id} className="border-t"><td className="py-2">{fmt(s.joinedAt)}</td><td>{s.name}</td><td className="font-mono text-xs">{s.ip ?? <span className="text-muted-foreground">{t('journal.reconciled')}</span>}</td><td><CountryFlag country={s.country} hasIp={s.ip != null} /></td><td>{duration(s.joinedAt, s.leftAt)}</td></tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'failures' && (failures.data?.items.length === 0 ? empty : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('journal.when')}</th><th>{t('journal.name')}</th><th>{t('journal.ip')}</th><th>{t('journal.country')}</th><th>{t('journal.reason')}</th></tr></thead>
            <tbody>{(failures.data?.items ?? []).map((f) => (
              <tr key={f.id} className="border-t"><td className="py-2">{fmt(f.createdAt)}</td><td>{f.name}</td><td className="font-mono text-xs">{f.ip ?? '—'}</td><td><CountryFlag country={f.country} hasIp={f.ip != null} /></td><td><Badge variant="warning">{t(`journal.reasons.${f.reason}`)}</Badge> <span className="text-xs text-muted-foreground">{f.message}</span></td></tr>
            ))}</tbody>
          </table>
        ))}
        {tab === 'web' && (web.data?.items.length === 0 ? empty : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('journal.when')}</th><th>{t('journal.name')}</th><th>{t('journal.ip')}</th><th>{t('journal.country')}</th><th>{t('journal.result')}</th></tr></thead>
            <tbody>{(web.data?.items ?? []).map((w) => (
              <tr key={w.id} className="border-t"><td className="py-2">{fmt(w.createdAt)}</td><td>{w.username}</td><td className="font-mono text-xs">{w.ip}</td><td><CountryFlag country={w.country} hasIp /></td>
                <td><Badge variant={w.success ? 'success' : 'destructive'}>{t(w.success ? 'journal.success' : 'journal.failure')}</Badge> {w.reason && <span className="text-xs text-muted-foreground">{t(`journal.reasons.${w.reason}`)}</span>}</td></tr>
            ))}</tbody>
          </table>
        ))}
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

- [ ] **Step 3: Carte de rétention**

Créer `packages/frontend/src/components/settings/JournalRetentionCard.tsx` :

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { journalApi } from '@/api/journal.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export function JournalRetentionCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['journal', 'retention'], queryFn: journalApi.retention });
  const [days, setDays] = useState<number | null>(null);
  const value = days ?? data?.days ?? 90;
  const save = useMutation({
    mutationFn: () => journalApi.setRetention(value),
    onSuccess: () => { toast.success(t('settings.users.journalRetention.saved')); setDays(null); void qc.invalidateQueries({ queryKey: ['journal', 'retention'] }); },
    onError: (err: { response?: { data?: { error?: string } } }) => toast.error(err.response?.data?.error || t('settings.users.journalRetention.failed')),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{t('settings.users.journalRetention.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Label htmlFor="journal-retention" className="text-xs w-40">{t('settings.users.journalRetention.days')}</Label>
          <Input id="journal-retention" className="h-8 text-xs w-24" type="number" min={0} max={3650} value={value} onChange={(e) => setDays(Math.max(0, Math.min(3650, parseInt(e.target.value || '0', 10))))} />
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.users.journalRetention.hint')}</p>
        <Button size="sm" disabled={save.isPending || days === null} onClick={() => save.mutate()}>{t('settings.users.journalRetention.save')}</Button>
      </CardContent>
    </Card>
  );
}
```

Dans `packages/frontend/src/pages/Settings.tsx`, importer `JournalRetentionCard` et rendre `<JournalRetentionCard />` dans `UsersTab`, juste après `<PasswordPolicyCard />` (même conteneur).

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck && pnpm lint`
Expected: PASS, lint sans erreur.

```bash
git add packages/frontend/src
git commit -m "feat(lot2a): page Journal et réglage de la rétention"
```

---

### Task 15: Documentation et vérification finale

**Files:**
- Modify: `README.md`, `README.fr.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-10-mc-manager-lot2a-joueurs-design.md` (statut)

- [ ] **Step 1: README (fr et en)**

Dans les deux README :

1. Dans « Fonctionnalités », ajouter après la puce Journal d'audit :
   - fr : `- Joueurs : joueurs en ligne et connus, fiches avec statistiques vanilla (temps de jeu, morts, kills, distance…), actions kick / ban / ban IP / op / deop, whitelist, opérateurs et bans gérés depuis l'interface`
   - fr : `- Journal de connexions (admin) : connexions Minecraft avec IP, pays et durée, refus de connexion, connexions à MC Manager réussies ou échouées ; rétention configurable (90 jours par défaut)`
   - en : équivalents (`Players: …`, `Connection journal (admin): …`).
2. Dans « Rôles », colonne `viewer` : ajouter « joueurs, fiches sans IP, whitelist, ops et bans en lecture seule » ; colonne `admin` : « actions sur les joueurs, whitelist, journal de connexions ».
3. Dans « Confidentialité », ajouter : la géolocalisation des IP utilise la base `geoip-lite` embarquée dans l'image (aucun appel externe, pays uniquement) ; les IP ne sont visibles que des admins ; le journal est purgé selon la rétention configurée.
4. Dans « Feuille de route », retirer « Statistiques par joueur », « Journal d'événements de jeu » et « Whitelist, ops, bans et kick » (livrés), garder « Restauration d'un backup » et « Éditeur de server.properties » sous un titre « Lot 2b ».

- [ ] **Step 2: CLAUDE.md**

Ajouter dans « Architecture backend », après la puce Audit :

```markdown
- **Joueurs (lot 2a)** : `players/player-journal.ts` ouvre et ferme des `PlayerSession` à partir des lignes du `LogStreamer` (`parse-player-line.ts`), réconciliées par le `list` du collecteur (`onPlayers`) avec une grâce de 30 s ; les lignes Docker sont horodatées (`timestamps: true`, préfixe retiré par `splitTimestamp`) pour ignorer l'historique rejoué au démarrage. `players/player-admin.ts` envoie kick/ban/op/whitelist par RCON et interprète les réponses (409 déjà fait, 404 inconnu, 502 réponse inattendue). `players/data-files.ts` lit `whitelist.json`, `ops.json`, `banned-*.json`, `usercache.json` et `<level-name>/stats/<uuid>.json` en lecture seule. Journal web : `auth/web-login-journal.ts`, appelé en fire-and-forget dans `auth.routes.ts`. Rétention : `AppSetting` `journal.retentionDays`, purge quotidienne depuis `index.ts`.
- **Messages WebSocket ajoutés** : `player.session` (join/leave, jamais d'IP) et `player.lists.changed`.
```

Dans « Invariants de sécurité », ajouter :

```markdown
- Lot 2a : les IP des joueurs et des connexions web ne sortent que par les routes `rbac('admin')` (`/api/journal/*`, fiche admin) ; `player.session` n'en porte jamais. Noms (`^[A-Za-z0-9_]{3,16}$`), IP (`net.isIP`) et raisons (une ligne, 100 caractères) sont validés dans `player-admin.ts` avant tout envoi RCON. Rien n'écrit dans `/data`.
```

Dans « Vue d'ensemble », remplacer la phrase sur le lot 2 par : « Le lot 2a (joueurs, journaux) est implémenté ; le lot 2b (restauration, éditeur de `server.properties`) ne l'est pas. »

- [ ] **Step 3: Statut de la spec**

Dans la spec du lot 2a, remplacer la ligne `**Statut :**` par `**Statut :** validé et implémenté (voir le plan 2026-10-10-mc-manager-lot2a-joueurs.md)`.

- [ ] **Step 4: Vérification complète**

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm db:generate
pnpm --filter @mc/common run build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: tout vert ; `pnpm audit` ne doit pas signaler de nouvel avis « high » non ignoré (geoip-lite ne devrait pas en apporter ; s'il en apporte un sans correctif, l'ajouter à `pnpm.auditConfig.ignoreGhsas` avec une note dans CLAUDE.md et le signaler dans le rapport).

- [ ] **Step 5: Commit**

```bash
git add README.md README.fr.md CLAUDE.md docs/superpowers/specs/2026-10-10-mc-manager-lot2a-joueurs-design.md
git commit -m "docs(lot2a): README, CLAUDE.md et statut de la spec"
```
