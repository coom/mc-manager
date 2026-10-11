# MC Manager lot 5 : réglages du monde en direct — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une page « Monde » (admin) qui ajuste à chaud par RCON l'heure, la météo, le tick, la difficulté, le mode de jeu par défaut et les gamerules usuelles, et expliquer dans la page Configuration comment libérer les clés cadenassées par l'environnement.

**Architecture:** Un catalogue fermé dans `@mc/common` (presets, gamerules) sert à la fois la validation backend et les contrôles frontend. Un `WorldService` (`packages/backend/src/world/`) construit les commandes RCON, interprète les réponses avec des parseurs tolérants et expose `read()` + setters ; des routes `/api/world` admin auditées renvoient l'état relu après chaque action. Le frontend ajoute une page `/world` en quatre cartes, interrogée à la demande (pas de WebSocket), et enrichit le texte du cadenas de `PropertiesForm`.

**Tech Stack:** TypeScript, Express, vitest + supertest (backend), React 18 + TanStack Query + react-i18next + Testing Library (frontend), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-11-mc-manager-lot5-monde-design.md`

## Global Constraints

- Node 20+, pnpm 9. Avant tout typecheck : `pnpm db:generate` puis `pnpm --filter @mc/common run build` (backend et frontend importent `@mc/common` depuis `dist/`). Relancer le build de common après chaque modification de `packages/common/src`.
- Ordre CI à reproduire avant de pousser : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Toutes les routes `/api/world` sont `requireRole('admin')` et auditées **avant** l'envoi RCON (comme `rcon.command`).
- Aucune commande libre : chaque valeur est contrainte à une liste fermée ou à un intervalle entier ; le nom de gamerule doit appartenir à `GAMERULES`.
- Rien n'est écrit dans `/data`, aucun nouveau message WebSocket, aucune table Prisma.
- Codes d'erreur : 400 valeur invalide, 403 viewer, 501 commande inconnue (`code: 'unsupported'`), 502 réponse inattendue, 503 RCON indisponible (levé par `RconService.send`).
- i18n : jamais éditer `fr.json`/`en.json` à la main ; écrire ou modifier un fragment dans `packages/frontend/scripts/i18n-fragments/` puis `node packages/frontend/scripts/merge-i18n.mjs`.
- Messages de commit en français, préfixés `feat(lot5):`, `test(lot5):` ou `docs(lot5):`, terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Textes utilisateur en français et en anglais, accents corrects.

## Review Focus

1. **`tick query` sur un serveur gelé ou en sprint** : la ligne « Target tick rate » peut être absente ou précédée d'une ligne d'état ; `parseTickStatus` doit renvoyer `frozen: true` sans perdre le taux quand il est présent, et jamais lever. Test ajouté en Task 2.
2. **Réponse RCON vide** (feedback coupé, serveur moddé) : un setter doit réussir (l'état est relu ensuite), pas renvoyer 502. Test ajouté en Task 4.
3. **`read()` sur un serveur 1.20.2** : `tick query` répond « Unknown or incomplete command » ; `tick.supported` doit être `false` et le reste de l'état complet. Test ajouté en Task 3.
4. **Gamerule entière reçue comme chaîne ou flottant depuis le navigateur** (`"5"`, `5.5`) : refus 400 avant tout envoi, aucune ligne d'audit. Tests ajoutés en Task 4 et Task 5.
5. **Changement d'état du serveur pendant que la page est ouverte** (`ready` → `stopped`) : la query doit se désactiver et l'état vide s'afficher sans erreur ni toast. Test ajouté en Task 6.

---

### Task 1 : catalogue et types partagés (`@mc/common`)

**Files:**
- Create: `packages/common/src/types/world.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `packages/common/src/types/audit.ts`

**Interfaces:**
- Produces: `TIME_PRESETS`, `WEATHER_KINDS`, `DIFFICULTIES`, `GAMEMODES`, `TICK_RATE`, `TICK_SPRINT_MAX`, `GAMERULES`, types `TimePreset`, `WeatherKind`, `Difficulty`, `Gamemode`, `GameruleDef`, `GameruleGroup`, `WorldState`, `WorldTickUpdate`; actions d'audit `world.time | world.weather | world.difficulty | world.gamemode | world.tick | world.gamerule`.

- [ ] **Step 1 : écrire `packages/common/src/types/world.ts`**

```ts
export const TIME_PRESETS = ['day', 'noon', 'night', 'midnight'] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];
export const WEATHER_KINDS = ['clear', 'rain', 'thunder'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
export type Gamemode = (typeof GAMEMODES)[number];
/** `/tick rate` accepte 1.0 à 10000.0 ; 20 est la normale. */
export const TICK_RATE = { min: 1, max: 10000, default: 20 } as const;
/** `/tick sprint` : une heure de jeu au plus (72000 ticks). */
export const TICK_SPRINT_MAX = 72000;

export type GameruleGroup = 'world' | 'players' | 'spawning' | 'misc';
export interface GameruleDef { name: string; type: 'bool' | 'int'; group: GameruleGroup; min?: number; max?: number }
/** Gamerules exposées par la page Monde ; seule liste acceptée par le backend. */
export const GAMERULES: readonly GameruleDef[] = [
  { name: 'doDaylightCycle', type: 'bool', group: 'world' },
  { name: 'doWeatherCycle', type: 'bool', group: 'world' },
  { name: 'randomTickSpeed', type: 'int', group: 'world', min: 0, max: 4096 },
  { name: 'doFireTick', type: 'bool', group: 'world' },
  { name: 'mobGriefing', type: 'bool', group: 'world' },
  { name: 'doTileDrops', type: 'bool', group: 'world' },
  { name: 'doEntityDrops', type: 'bool', group: 'world' },
  { name: 'doMobLoot', type: 'bool', group: 'world' },
  { name: 'keepInventory', type: 'bool', group: 'players' },
  { name: 'naturalRegeneration', type: 'bool', group: 'players' },
  { name: 'doImmediateRespawn', type: 'bool', group: 'players' },
  { name: 'playersSleepingPercentage', type: 'int', group: 'players', min: 0, max: 100 },
  { name: 'spawnRadius', type: 'int', group: 'players', min: 0, max: 128 },
  { name: 'fallDamage', type: 'bool', group: 'players' },
  { name: 'drowningDamage', type: 'bool', group: 'players' },
  { name: 'fireDamage', type: 'bool', group: 'players' },
  { name: 'freezeDamage', type: 'bool', group: 'players' },
  { name: 'doMobSpawning', type: 'bool', group: 'spawning' },
  { name: 'doInsomnia', type: 'bool', group: 'spawning' },
  { name: 'doPatrolSpawning', type: 'bool', group: 'spawning' },
  { name: 'doTraderSpawning', type: 'bool', group: 'spawning' },
  { name: 'doWardenSpawning', type: 'bool', group: 'spawning' },
  { name: 'disableRaids', type: 'bool', group: 'spawning' },
  { name: 'maxEntityCramming', type: 'int', group: 'spawning', min: 0, max: 100 },
  { name: 'announceAdvancements', type: 'bool', group: 'misc' },
  { name: 'showDeathMessages', type: 'bool', group: 'misc' },
  { name: 'commandBlockOutput', type: 'bool', group: 'misc' },
  { name: 'sendCommandFeedback', type: 'bool', group: 'misc' },
];
export const GAMERULE_GROUPS: readonly GameruleGroup[] = ['world', 'players', 'spawning', 'misc'];

export interface WorldState {
  /** daytime 0..23999 (0 = 06:00 en jeu), day = nombre de jours écoulés ; null si réponse non reconnue. */
  time: { daytime: number | null; day: number | null };
  /** supported = false avant Minecraft 1.20.3 (`/tick` inconnu). */
  tick: { supported: boolean; targetRate: number | null; frozen: boolean; sprinting: boolean };
  difficulty: Difficulty | null;
  /** Lu dans server.properties (clé `gamemode`), que le serveur réécrit à chaque /defaultgamemode. */
  defaultGamemode: Gamemode | null;
  /** Une clé par entrée de GAMERULES ; null si réponse non reconnue. */
  gamerules: Record<string, boolean | number | null>;
  /** Variable itzg qui réécrira la clé au redémarrage (absente si le fichier est maître). */
  resetOnRestart: { difficulty?: string; gamemode?: string };
}
export type WorldTickUpdate = { rate: number } | { frozen: boolean } | { sprint: number };
```

- [ ] **Step 2 : exporter et étendre `AuditAction`**

Dans `packages/common/src/index.ts`, ajouter après la ligne `export * from './types/mods.js';` :

```ts
export * from './types/world.js';
```

Dans `packages/common/src/types/audit.ts`, remplacer la dernière ligne de l'union `| 'mods.upload' | 'mods.file.delete';` par :

```ts
  | 'mods.upload' | 'mods.file.delete'
  | 'world.time' | 'world.weather' | 'world.difficulty' | 'world.gamemode' | 'world.tick' | 'world.gamerule';
```

- [ ] **Step 3 : builder common et vérifier**

Run: `pnpm --filter @mc/common run build && pnpm --filter @mc/common run typecheck`
Expected: succès, `packages/common/dist/types/world.d.ts` existe.

- [ ] **Step 4 : commit**

```bash
git add packages/common/src/types/world.ts packages/common/src/index.ts packages/common/src/types/audit.ts
git commit -m "feat(lot5): catalogue et types partagés des réglages du monde

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : parseurs RCON du monde

**Files:**
- Create: `packages/backend/src/world/parsers.ts`
- Test: `packages/backend/src/world/parsers.test.ts`

**Interfaces:**
- Consumes: `stripColors` de `../rcon/parsers.js` ; `DIFFICULTIES`, `Difficulty` de `@mc/common`.
- Produces: `isUnknownCommand(raw): boolean`, `parseTimeQuery(raw): number | null`, `parseGamerule(raw): boolean | number | null`, `parseDifficulty(raw): Difficulty | null`, `parseTickStatus(raw): { targetRate: number | null; frozen: boolean; sprinting: boolean } | null`.

- [ ] **Step 1 : écrire le test**

`packages/backend/src/world/parsers.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { isUnknownCommand, parseTimeQuery, parseGamerule, parseDifficulty, parseTickStatus } from './parsers.js';

describe('world parsers', () => {
  it('detects an unknown command, with or without colours', () => {
    expect(isUnknownCommand('Unknown or incomplete command, see below for error\ntick query<--[HERE]')).toBe(true);
    expect(isUnknownCommand('§cUnknown command')).toBe(true);
    expect(isUnknownCommand('Target tick rate: 20.0 per second.')).toBe(false);
    expect(isUnknownCommand('')).toBe(false);
  });
  it('parses time queries', () => {
    expect(parseTimeQuery('The time is 6000')).toBe(6000);
    expect(parseTimeQuery('§eThe time is §f12')).toBe(12);
    expect(parseTimeQuery('Unknown or incomplete command')).toBeNull();
    expect(parseTimeQuery('')).toBeNull();
  });
  it('parses gamerule reads and writes', () => {
    expect(parseGamerule('Gamerule keepInventory is currently set to: false')).toBe(false);
    expect(parseGamerule('Gamerule keepInventory is now set to: true')).toBe(true);
    expect(parseGamerule('Gamerule randomTickSpeed is currently set to: 3')).toBe(3);
    expect(parseGamerule('Gamerule spawnRadius is now set to: 0')).toBe(0);
    expect(parseGamerule('Unknown or incomplete command')).toBeNull();
    expect(parseGamerule('Gamerule foo is currently set to: maybe')).toBeNull();
  });
  it('parses the difficulty in lowercase and rejects unknown values', () => {
    expect(parseDifficulty('The difficulty is Normal')).toBe('normal');
    expect(parseDifficulty('§aThe difficulty is Peaceful')).toBe('peaceful');
    expect(parseDifficulty('The difficulty is Brutal')).toBeNull();
    expect(parseDifficulty('')).toBeNull();
  });
  it('parses tick status when running, frozen or sprinting', () => {
    expect(parseTickStatus('Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)\nPercentiles: P50: 2.9ms P95: 5.1ms P99: 9.0ms, sample: 100'))
      .toEqual({ targetRate: 20, frozen: false, sprinting: false });
    expect(parseTickStatus('The game is frozen\nTarget tick rate: 40.0 per second.\nAverage time per tick: 0.1ms'))
      .toEqual({ targetRate: 40, frozen: true, sprinting: false });
    expect(parseTickStatus('The game is sprinting\nTarget tick rate: 20.0 per second.'))
      .toEqual({ targetRate: 20, frozen: false, sprinting: true });
    // Ligne de taux absente : l'état est quand même rendu.
    expect(parseTickStatus('The game is frozen')).toEqual({ targetRate: null, frozen: true, sprinting: false });
    expect(parseTickStatus('§aTarget tick rate: §f12.5§a per second.')?.targetRate).toBe(12.5);
    expect(parseTickStatus('Unknown or incomplete command')).toBeNull();
    expect(parseTickStatus('')).toBeNull();
  });
});
```

- [ ] **Step 2 : lancer le test, vérifier l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/world/parsers.test.ts`
Expected: FAIL, module `./parsers.js` introuvable.

- [ ] **Step 3 : écrire `packages/backend/src/world/parsers.ts`**

```ts
import { DIFFICULTIES, type Difficulty } from '@mc/common';
import { stripColors } from '../rcon/parsers.js';

/** « Unknown or incomplete command » (commande absente de cette version, ex. /tick avant 1.20.3). */
export function isUnknownCommand(raw: string): boolean {
  return /unknown (?:or incomplete )?command/i.test(stripColors(raw));
}

/** `time query daytime` / `time query day` → « The time is 6000 ». */
export function parseTimeQuery(raw: string): number | null {
  const m = /The time is (\d+)/i.exec(stripColors(raw));
  return m ? parseInt(m[1], 10) : null;
}

/** `gamerule <name>` → « … is currently set to: X » ; `gamerule <name> <v>` → « … is now set to: X ». */
export function parseGamerule(raw: string): boolean | number | null {
  const m = /Gamerule \w+ is (?:currently|now) set to:\s*(\S+)/i.exec(stripColors(raw));
  if (!m) return null;
  if (m[1] === 'true') return true;
  if (m[1] === 'false') return false;
  return /^-?\d+$/.test(m[1]) ? parseInt(m[1], 10) : null;
}

/** `difficulty` → « The difficulty is Normal ». */
export function parseDifficulty(raw: string): Difficulty | null {
  const m = /The difficulty is (\w+)/i.exec(stripColors(raw));
  const d = m?.[1].toLowerCase();
  return d && (DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : null;
}

/**
 * `tick query` : ligne « Target tick rate: 20.0 per second. » et, selon l'état, une ligne contenant
 * « frozen » ou « sprinting ». Tolérant : l'absence de la ligne de taux ne masque pas l'état.
 */
export function parseTickStatus(raw: string): { targetRate: number | null; frozen: boolean; sprinting: boolean } | null {
  const s = stripColors(raw);
  const rate = /Target tick rate:\s*([\d.]+)/i.exec(s);
  const frozen = /\bfrozen\b/i.test(s);
  const sprinting = /\bsprint/i.test(s);
  if (!rate && !frozen && !sprinting) return null;
  return { targetRate: rate ? parseFloat(rate[1]) : null, frozen, sprinting };
}
```

- [ ] **Step 4 : lancer le test, vérifier le succès**

Run: `pnpm --filter @mc/backend exec vitest run src/world/parsers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/world/parsers.ts packages/backend/src/world/parsers.test.ts
git commit -m "feat(lot5): parseurs RCON de l'état du monde

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : `WorldService.read()`

**Files:**
- Create: `packages/backend/src/world/world-service.ts`
- Test: `packages/backend/src/world/world-service.test.ts`

**Interfaces:**
- Consumes: parseurs de la Task 2 ; `lockedKeys` de `../server-properties/itzg-env.js` ; `GAMERULES`, `GAMEMODES`, `WorldState` de `@mc/common`.
- Produces: `interface WorldDeps { rcon: { send(cmd: string): Promise<string> }; docker: { inspectServer(): Promise<{ env: string[] } | null> }; properties: { read(): Promise<{ values: Record<string, string> }> } }` ; `class WorldService { constructor(deps: WorldDeps); read(): Promise<WorldState> }`.

- [ ] **Step 1 : écrire le test avec un faux RCON scripté**

`packages/backend/src/world/world-service.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { GAMERULES } from '@mc/common';
import { WorldService } from './world-service.js';
import { AppError } from '../middleware/error-handler.js';

/** Faux RCON : réponses par commande exacte, « Unknown or incomplete command » sinon ; garde la trace des envois. */
export function fakeRcon(replies: Record<string, string> = {}) {
  const sent: string[] = [];
  return {
    sent,
    replies,
    send: async (cmd: string) => { sent.push(cmd); return replies[cmd] ?? 'Unknown or incomplete command, see below for error'; },
  };
}
const vanillaReplies = () => ({
  'time query daytime': 'The time is 6000',
  'time query day': 'The time is 12',
  'tick query': 'Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)',
  difficulty: 'The difficulty is Normal',
  ...Object.fromEntries(GAMERULES.map((g) => [`gamerule ${g.name}`, `Gamerule ${g.name} is currently set to: ${g.type === 'bool' ? 'true' : '3'}`])),
});
const deps = (rcon: ReturnType<typeof fakeRcon>, opts: { env?: string[]; gamemode?: string } = {}) => ({
  rcon,
  docker: { inspectServer: async () => ({ env: opts.env ?? [] }) },
  properties: { read: async () => ({ values: opts.gamemode === undefined ? {} : { gamemode: opts.gamemode } }) },
});

describe('WorldService.read', () => {
  it('reads time, tick, difficulty, every catalogue gamerule and the default gamemode from server.properties', async () => {
    const rcon = fakeRcon(vanillaReplies());
    const state = await new WorldService(deps(rcon, { gamemode: 'Survival' })).read();
    expect(state.time).toEqual({ daytime: 6000, day: 12 });
    expect(state.tick).toEqual({ supported: true, targetRate: 20, frozen: false, sprinting: false });
    expect(state.difficulty).toBe('normal');
    expect(state.defaultGamemode).toBe('survival');
    expect(Object.keys(state.gamerules).sort()).toEqual(GAMERULES.map((g) => g.name).sort());
    expect(state.gamerules.keepInventory).toBe(true);
    expect(state.gamerules.randomTickSpeed).toBe(3);
    expect(state.resetOnRestart).toEqual({});
    expect(rcon.sent[0]).toBe('time query daytime');
    expect(rcon.sent).toContain('gamerule keepInventory');
  });
  it('marks tick as unsupported before 1.20.3 and keeps the rest of the state', async () => {
    const replies = vanillaReplies(); delete (replies as Record<string, string>)['tick query'];
    const state = await new WorldService(deps(fakeRcon(replies))).read();
    expect(state.tick).toEqual({ supported: false, targetRate: null, frozen: false, sprinting: false });
    expect(state.difficulty).toBe('normal');
  });
  it('reports frozen and sprinting states', async () => {
    const replies = { ...vanillaReplies(), 'tick query': 'The game is frozen\nTarget tick rate: 20.0 per second.' };
    expect((await new WorldService(deps(fakeRcon(replies))).read()).tick).toEqual({ supported: true, targetRate: 20, frozen: true, sprinting: false });
  });
  it('turns unrecognised replies into null without failing', async () => {
    const replies = { ...vanillaReplies(), 'time query daytime': 'weird', difficulty: 'The difficulty is Brutal', 'gamerule keepInventory': 'nope' };
    const state = await new WorldService(deps(fakeRcon(replies), { gamemode: 'hardcore' })).read();
    expect(state.time.daytime).toBeNull();
    expect(state.difficulty).toBeNull();
    expect(state.gamerules.keepInventory).toBeNull();
    expect(state.gamerules.mobGriefing).toBe(true);
    expect(state.defaultGamemode).toBeNull();
  });
  it('reports the itzg variables that will reset difficulty and gamemode at restart', async () => {
    const env = ['DIFFICULTY=hard', 'MODE=creative', 'MOTD=hi'];
    expect((await new WorldService(deps(fakeRcon(vanillaReplies()), { env })).read()).resetOnRestart).toEqual({ difficulty: 'DIFFICULTY', gamemode: 'MODE' });
    expect((await new WorldService(deps(fakeRcon(vanillaReplies()), { env: [...env, 'OVERRIDE_SERVER_PROPERTIES=false'] })).read()).resetOnRestart).toEqual({});
  });
  it('tolerates docker and properties failures', async () => {
    const svc = new WorldService({ rcon: fakeRcon(vanillaReplies()), docker: { inspectServer: async () => { throw new Error('no socket'); } }, properties: { read: async () => { throw new Error('ENOENT'); } } });
    const state = await svc.read();
    expect(state.resetOnRestart).toEqual({});
    expect(state.defaultGamemode).toBeNull();
  });
  it('propagates an RCON outage', async () => {
    const rcon = { send: async () => { throw new AppError(503, 'RCON not connected'); } };
    await expect(new WorldService(deps(rcon as never)).read()).rejects.toMatchObject({ statusCode: 503 });
  });
});
```

- [ ] **Step 2 : lancer le test, vérifier l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/world/world-service.test.ts`
Expected: FAIL, module `./world-service.js` introuvable.

- [ ] **Step 3 : écrire `packages/backend/src/world/world-service.ts` (lecture seule pour l'instant)**

```ts
import { GAMERULES, GAMEMODES, type Gamemode, type WorldState } from '@mc/common';
import { lockedKeys } from '../server-properties/itzg-env.js';
import { isUnknownCommand, parseDifficulty, parseGamerule, parseTickStatus, parseTimeQuery } from './parsers.js';

export interface WorldDeps {
  rcon: { send(cmd: string): Promise<string> };
  docker: { inspectServer(): Promise<{ env: string[] } | null> };
  properties: { read(): Promise<{ values: Record<string, string> }> };
}

const NO_TICK = { targetRate: null, frozen: false, sprinting: false };

/**
 * Réglages du monde appliqués à chaud par RCON (heure, météo, tick, difficulté, mode de jeu, gamerules).
 * Rien n'est écrit dans /data : le serveur persiste lui-même ces valeurs dans le monde.
 */
export class WorldService {
  constructor(private deps: WorldDeps) {}

  /** État courant ; une réponse non reconnue donne null pour le champ concerné, jamais une erreur. */
  async read(): Promise<WorldState> {
    const send = (cmd: string) => this.deps.rcon.send(cmd);
    const daytime = parseTimeQuery(await send('time query daytime'));
    const day = parseTimeQuery(await send('time query day'));
    const tickRaw = await send('tick query');
    const tick = isUnknownCommand(tickRaw) ? { supported: false, ...NO_TICK } : { supported: true, ...(parseTickStatus(tickRaw) ?? NO_TICK) };
    const difficulty = parseDifficulty(await send('difficulty'));
    const gamerules: Record<string, boolean | number | null> = {};
    for (const g of GAMERULES) gamerules[g.name] = parseGamerule(await send(`gamerule ${g.name}`));
    const props = await this.deps.properties.read().catch(() => null);
    const gm = props?.values.gamemode?.toLowerCase();
    const defaultGamemode = gm && (GAMEMODES as readonly string[]).includes(gm) ? (gm as Gamemode) : null;
    const inspect = await this.deps.docker.inspectServer().catch(() => null);
    const locked = lockedKeys(inspect?.env ?? []);
    const resetOnRestart: WorldState['resetOnRestart'] = {};
    if (locked.difficulty && locked.difficulty !== 'rcon') resetOnRestart.difficulty = locked.difficulty;
    if (locked.gamemode && locked.gamemode !== 'rcon') resetOnRestart.gamemode = locked.gamemode;
    return { time: { daytime, day }, tick, difficulty, defaultGamemode, gamerules, resetOnRestart };
  }
}
```

- [ ] **Step 4 : lancer le test, vérifier le succès**

Run: `pnpm --filter @mc/backend exec vitest run src/world/world-service.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/world/world-service.ts packages/backend/src/world/world-service.test.ts
git commit -m "feat(lot5): lecture de l'état du monde par RCON

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : validation et setters du `WorldService`

**Files:**
- Create: `packages/backend/src/world/validate.ts`
- Test: `packages/backend/src/world/validate.test.ts`
- Modify: `packages/backend/src/world/world-service.ts`
- Modify: `packages/backend/src/world/world-service.test.ts`

**Interfaces:**
- Produces (`validate.ts`) : `assertPreset(v: unknown): TimePreset`, `assertWeather(v): WeatherKind`, `assertDifficulty(v): Difficulty`, `assertGamemode(v): Gamemode`, `assertTick(body: unknown): WorldTickUpdate`, `assertGamerule(name: unknown, value: unknown): { name: string; value: boolean | number }` ; chacun lève `AppError(400, …)`.
- Produces (`WorldService`) : `setTime(preset)`, `setWeather(kind)`, `setDifficulty(d)`, `setDefaultGamemode(g)`, `setTick(update)`, `setGamerule(name, value)` → `Promise<void>` ; 501 (`code: 'unsupported'`) si commande inconnue, 502 si réponse d'erreur, succès sinon (y compris réponse vide ou « did not change »).

- [ ] **Step 1 : écrire le test des validateurs**

`packages/backend/src/world/validate.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { assertPreset, assertWeather, assertDifficulty, assertGamemode, assertTick, assertGamerule } from './validate.js';

const bad = (fn: () => unknown) => expect(fn).toThrowError(expect.objectContaining({ statusCode: 400 }));

describe('world validators', () => {
  it('accepts catalogue values only', () => {
    expect(assertPreset('day')).toBe('day'); bad(() => assertPreset('dawn')); bad(() => assertPreset(1));
    expect(assertWeather('thunder')).toBe('thunder'); bad(() => assertWeather('snow'));
    expect(assertDifficulty('hard')).toBe('hard'); bad(() => assertDifficulty('Hard'));
    expect(assertGamemode('spectator')).toBe('spectator'); bad(() => assertGamemode('hardcore'));
  });
  it('validates tick updates: one field, bounded', () => {
    expect(assertTick({ rate: 40 })).toEqual({ rate: 40 });
    expect(assertTick({ rate: 12.5 })).toEqual({ rate: 12.5 });
    expect(assertTick({ frozen: true })).toEqual({ frozen: true });
    expect(assertTick({ sprint: 1200 })).toEqual({ sprint: 1200 });
    bad(() => assertTick({ rate: 0 })); bad(() => assertTick({ rate: 10001 })); bad(() => assertTick({ rate: '40' })); bad(() => assertTick({ rate: NaN }));
    bad(() => assertTick({ frozen: 'yes' }));
    bad(() => assertTick({ sprint: 0 })); bad(() => assertTick({ sprint: 72001 })); bad(() => assertTick({ sprint: 1.5 }));
    bad(() => assertTick({ rate: 20, frozen: true })); bad(() => assertTick({})); bad(() => assertTick(null));
  });
  it('validates gamerules against the catalogue, by type and bounds', () => {
    expect(assertGamerule('keepInventory', true)).toEqual({ name: 'keepInventory', value: true });
    expect(assertGamerule('randomTickSpeed', 100)).toEqual({ name: 'randomTickSpeed', value: 100 });
    bad(() => assertGamerule('keepInventory', 'true'));
    bad(() => assertGamerule('randomTickSpeed', '5'));
    bad(() => assertGamerule('randomTickSpeed', 5.5));
    bad(() => assertGamerule('randomTickSpeed', -1));
    bad(() => assertGamerule('randomTickSpeed', 4097));
    bad(() => assertGamerule('randomTickSpeed', true));
    bad(() => assertGamerule('notARule', true));
    bad(() => assertGamerule('keepInventory; say hi', true));
  });
});
```

- [ ] **Step 2 : lancer le test, vérifier l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/world/validate.test.ts`
Expected: FAIL, module `./validate.js` introuvable.

- [ ] **Step 3 : écrire `packages/backend/src/world/validate.ts`**

```ts
import { DIFFICULTIES, GAMEMODES, GAMERULES, TICK_RATE, TICK_SPRINT_MAX, TIME_PRESETS, WEATHER_KINDS, type Difficulty, type Gamemode, type TimePreset, type WeatherKind, type WorldTickUpdate } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new AppError(400, `Invalid ${what}`);
  return v as T;
}
export const assertPreset = (v: unknown): TimePreset => oneOf(TIME_PRESETS, v, 'time preset');
export const assertWeather = (v: unknown): WeatherKind => oneOf(WEATHER_KINDS, v, 'weather');
export const assertDifficulty = (v: unknown): Difficulty => oneOf(DIFFICULTIES, v, 'difficulty');
export const assertGamemode = (v: unknown): Gamemode => oneOf(GAMEMODES, v, 'gamemode');

/** Exactement un champ parmi rate (1..10000, décimal accepté), frozen (booléen), sprint (entier 1..72000). */
export function assertTick(body: unknown): WorldTickUpdate {
  if (!body || typeof body !== 'object') throw new AppError(400, 'Body must contain rate, frozen or sprint');
  const b = body as Record<string, unknown>;
  const fields = ['rate', 'frozen', 'sprint'].filter((k) => k in b);
  if (fields.length !== 1) throw new AppError(400, 'Body must contain exactly one of rate, frozen or sprint');
  if (fields[0] === 'rate') {
    if (typeof b.rate !== 'number' || !Number.isFinite(b.rate) || b.rate < TICK_RATE.min || b.rate > TICK_RATE.max) throw new AppError(400, `rate must be a number between ${TICK_RATE.min} and ${TICK_RATE.max}`);
    return { rate: b.rate };
  }
  if (fields[0] === 'frozen') {
    if (typeof b.frozen !== 'boolean') throw new AppError(400, 'frozen must be a boolean');
    return { frozen: b.frozen };
  }
  if (!Number.isInteger(b.sprint) || (b.sprint as number) < 1 || (b.sprint as number) > TICK_SPRINT_MAX) throw new AppError(400, `sprint must be an integer between 1 and ${TICK_SPRINT_MAX}`);
  return { sprint: b.sprint as number };
}

/** Nom dans le catalogue, valeur du bon type et dans les bornes : rien d'autre n'atteint la console. */
export function assertGamerule(name: unknown, value: unknown): { name: string; value: boolean | number } {
  const def = typeof name === 'string' ? GAMERULES.find((g) => g.name === name) : undefined;
  if (!def) throw new AppError(400, 'Unknown gamerule');
  if (def.type === 'bool') {
    if (typeof value !== 'boolean') throw new AppError(400, `${def.name} must be a boolean`);
    return { name: def.name, value };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
    throw new AppError(400, `${def.name} must be an integer between ${def.min ?? '-∞'} and ${def.max ?? '∞'}`);
  }
  return { name: def.name, value };
}
```

- [ ] **Step 4 : lancer le test des validateurs, vérifier le succès**

Run: `pnpm --filter @mc/backend exec vitest run src/world/validate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5 : ajouter les tests des setters**

Dans `packages/backend/src/world/world-service.test.ts`, ajouter en fin de fichier :

```ts
describe('WorldService setters', () => {
  const svc = (rcon: ReturnType<typeof fakeRcon>) => new WorldService(deps(rcon));
  it('sends one exact command per action', async () => {
    const rcon = fakeRcon({
      'time set night': 'Set the time to 13000', 'weather thunder': 'Set the weather to thunder', 'difficulty hard': 'The difficulty has been set to Hard',
      'defaultgamemode creative': 'The default game mode is now Creative Mode', 'tick rate 40': 'Set the target tick rate to 40.0 per second',
      'tick freeze': 'The game is now frozen', 'tick unfreeze': 'The game is now running', 'tick sprint 1200': 'Sprinting 1200 ticks',
      'gamerule keepInventory true': 'Gamerule keepInventory is now set to: true', 'gamerule randomTickSpeed 100': 'Gamerule randomTickSpeed is now set to: 100',
    });
    const s = svc(rcon);
    await s.setTime('night'); await s.setWeather('thunder'); await s.setDifficulty('hard'); await s.setDefaultGamemode('creative');
    await s.setTick({ rate: 40 }); await s.setTick({ frozen: true }); await s.setTick({ frozen: false }); await s.setTick({ sprint: 1200 });
    await s.setGamerule('keepInventory', true); await s.setGamerule('randomTickSpeed', 100);
    expect(rcon.sent).toEqual(['time set night', 'weather thunder', 'difficulty hard', 'defaultgamemode creative', 'tick rate 40', 'tick freeze', 'tick unfreeze', 'tick sprint 1200', 'gamerule keepInventory true', 'gamerule randomTickSpeed 100']);
  });
  it('treats an empty reply and a "did not change" reply as success', async () => {
    const rcon = fakeRcon({ 'difficulty normal': 'The difficulty did not change; it is already set to Normal', 'gamerule keepInventory false': '' });
    await expect(svc(rcon).setDifficulty('normal')).resolves.toBeUndefined();
    await expect(svc(rcon).setGamerule('keepInventory', false)).resolves.toBeUndefined();
  });
  it('maps an unknown command to 501 with the unsupported code', async () => {
    await expect(svc(fakeRcon()).setTick({ rate: 40 })).rejects.toMatchObject({ statusCode: 501, code: 'unsupported' });
  });
  it('maps an argument error to 502', async () => {
    const rcon = fakeRcon({ 'gamerule randomTickSpeed 100': 'Incorrect argument for command' });
    await expect(svc(rcon).setGamerule('randomTickSpeed', 100)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('validates before sending anything', async () => {
    const rcon = fakeRcon();
    await expect(svc(rcon).setGamerule('randomTickSpeed', '5' as never)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc(rcon).setTick({ rate: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc(rcon).setTime('dawn' as never)).rejects.toMatchObject({ statusCode: 400 });
    expect(rcon.sent).toEqual([]);
  });
});
```

- [ ] **Step 6 : lancer, vérifier l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/world/world-service.test.ts`
Expected: FAIL, `setTime is not a function`.

- [ ] **Step 7 : ajouter les setters à `WorldService`**

Dans `packages/backend/src/world/world-service.ts`, compléter les imports :

```ts
import { GAMERULES, GAMEMODES, type Difficulty, type Gamemode, type TimePreset, type WeatherKind, type WorldState, type WorldTickUpdate } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';
import { stripColors } from '../rcon/parsers.js';
import { lockedKeys } from '../server-properties/itzg-env.js';
import { isUnknownCommand, parseDifficulty, parseGamerule, parseTickStatus, parseTimeQuery } from './parsers.js';
import { assertDifficulty, assertGamemode, assertGamerule, assertPreset, assertTick, assertWeather } from './validate.js';
```

et ajouter dans la classe, après `read()` :

```ts
  /** Envoie une commande validée ; seuls les motifs d'erreur sont interprétés, la phrase de confirmation varie selon le serveur. */
  private async run(cmd: string): Promise<void> {
    const raw = stripColors(await this.deps.rcon.send(cmd));
    if (isUnknownCommand(raw)) throw new AppError(501, 'Command not supported by this server', undefined, 'unsupported');
    if (/incorrect argument|expected |invalid|unknown/i.test(raw)) throw new AppError(502, `Unexpected server response: ${raw.slice(0, 200)}`);
  }

  setTime(preset: TimePreset): Promise<void> { return this.run(`time set ${assertPreset(preset)}`); }
  setWeather(kind: WeatherKind): Promise<void> { return this.run(`weather ${assertWeather(kind)}`); }
  setDifficulty(d: Difficulty): Promise<void> { return this.run(`difficulty ${assertDifficulty(d)}`); }
  setDefaultGamemode(g: Gamemode): Promise<void> { return this.run(`defaultgamemode ${assertGamemode(g)}`); }
  setTick(update: WorldTickUpdate): Promise<void> {
    const u = assertTick(update);
    if ('rate' in u) return this.run(`tick rate ${u.rate}`);
    if ('frozen' in u) return this.run(u.frozen ? 'tick freeze' : 'tick unfreeze');
    return this.run(`tick sprint ${u.sprint}`);
  }
  setGamerule(name: string, value: boolean | number): Promise<void> {
    const g = assertGamerule(name, value);
    return this.run(`gamerule ${g.name} ${g.value}`);
  }
```

Les validateurs lèvent de façon synchrone dans une méthode non `async` : pour que le test `rejects` fonctionne, déclarer les six setters `async` (ex. `async setTime(preset: TimePreset): Promise<void> { await this.run(...); }`). Appliquer cette forme aux six.

- [ ] **Step 8 : lancer, vérifier le succès**

Run: `pnpm --filter @mc/backend exec vitest run src/world/`
Expected: PASS (parsers, validate, world-service : 15 tests).

- [ ] **Step 9 : commit**

```bash
git add packages/backend/src/world/
git commit -m "feat(lot5): validation et commandes des réglages du monde

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : routes `/api/world` et câblage

**Files:**
- Create: `packages/backend/src/routes/world.routes.ts`
- Test: `packages/backend/src/routes/world.routes.test.ts`
- Modify: `packages/backend/src/app.ts` (après `app.use('/api/mods', modsRoutes);`)
- Modify: `packages/backend/src/index.ts` (après la ligne `app.locals.properties = …`)

**Interfaces:**
- Consumes: `WorldService` (Task 3-4), validateurs (Task 4), `audit`, `requireRole`.
- Produces: `GET /api/world` → `WorldState` ; `PUT /api/world/time|weather|difficulty|gamemode|tick`, `PUT /api/world/gamerules/:name` → `WorldState` relu ; `app.locals.world`.

- [ ] **Step 1 : écrire le test des routes**

`packages/backend/src/routes/world.routes.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { worldRoutes } from './world.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

const state = { time: { daytime: 6000, day: 1 }, tick: { supported: true, targetRate: 20, frozen: false, sprinting: false }, difficulty: 'normal', defaultGamemode: 'survival', gamerules: { keepInventory: false }, resetOnRestart: {} };

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.world = {
    read: vi.fn().mockResolvedValue(state),
    setTime: vi.fn().mockResolvedValue(undefined), setWeather: vi.fn().mockResolvedValue(undefined), setDifficulty: vi.fn().mockResolvedValue(undefined),
    setDefaultGamemode: vi.fn().mockResolvedValue(undefined), setTick: vi.fn().mockResolvedValue(undefined), setGamerule: vi.fn().mockResolvedValue(undefined),
  };
  app.use('/api/world', worldRoutes);
  app.use(errorHandler);
  return app;
}
const auditOf = (app: ReturnType<typeof appWith>) => app.locals.prisma.auditLog.create;

describe('world routes', () => {
  it('refuses viewers everywhere', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/world')).status).toBe(403);
    expect((await request(app).put('/api/world/time').send({ preset: 'day' })).status).toBe(403);
    expect((await request(app).put('/api/world/gamerules/keepInventory').send({ value: true })).status).toBe(403);
    expect(app.locals.world.setTime).not.toHaveBeenCalled();
  });
  it('admin reads the state', async () => {
    const res = await request(appWith('admin')).get('/api/world');
    expect(res.status).toBe(200);
    expect(res.body.difficulty).toBe('normal');
  });
  it('each action is audited before the command and returns the re-read state', async () => {
    const app = appWith('admin');
    const cases: [string, object, string, string, unknown[]][] = [
      ['/api/world/time', { preset: 'night' }, 'world.time', 'night', ['night']],
      ['/api/world/weather', { kind: 'rain' }, 'world.weather', 'rain', ['rain']],
      ['/api/world/difficulty', { difficulty: 'hard' }, 'world.difficulty', 'hard', ['hard']],
      ['/api/world/gamemode', { gamemode: 'creative' }, 'world.gamemode', 'creative', ['creative']],
      ['/api/world/tick', { rate: 40 }, 'world.tick', 'rate=40', [{ rate: 40 }]],
      ['/api/world/tick', { frozen: true }, 'world.tick', 'frozen=true', [{ frozen: true }]],
      ['/api/world/tick', { sprint: 1200 }, 'world.tick', 'sprint=1200', [{ sprint: 1200 }]],
      ['/api/world/gamerules/keepInventory', { value: true }, 'world.gamerule', 'keepInventory=true', ['keepInventory', true]],
    ];
    for (const [path, body, action, detail, args] of cases) {
      const res = await request(app).put(path).send(body);
      expect(res.status, path).toBe(200);
      expect(res.body).toEqual(state);
      expect(auditOf(app)).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action, detail }) }));
      const fn = { 'world.time': 'setTime', 'world.weather': 'setWeather', 'world.difficulty': 'setDifficulty', 'world.gamemode': 'setDefaultGamemode', 'world.tick': 'setTick', 'world.gamerule': 'setGamerule' }[action]!;
      expect(app.locals.world[fn]).toHaveBeenCalledWith(...args);
    }
  });
  it('rejects invalid bodies with 400 and no audit line', async () => {
    const app = appWith('admin');
    expect((await request(app).put('/api/world/time').send({ preset: 'dawn' })).status).toBe(400);
    expect((await request(app).put('/api/world/tick').send({ rate: '40' })).status).toBe(400);
    expect((await request(app).put('/api/world/tick').send({})).status).toBe(400);
    expect((await request(app).put('/api/world/gamerules/randomTickSpeed').send({ value: 5.5 })).status).toBe(400);
    expect((await request(app).put('/api/world/gamerules/notARule').send({ value: true })).status).toBe(400);
    expect(auditOf(app)).not.toHaveBeenCalled();
    expect(app.locals.world.setTick).not.toHaveBeenCalled();
  });
  it('audits even when the command fails, and surfaces the service error', async () => {
    const app = appWith('admin');
    app.locals.world.setTick.mockRejectedValue(new AppError(501, 'Command not supported by this server', undefined, 'unsupported'));
    const res = await request(app).put('/api/world/tick').send({ rate: 40 });
    expect(res.status).toBe(501);
    expect(res.body.code).toBe('unsupported');
    expect(auditOf(app)).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/world.routes.test.ts`
Expected: FAIL, module `./world.routes.js` introuvable.

- [ ] **Step 3 : écrire `packages/backend/src/routes/world.routes.ts`**

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuditAction } from '@mc/common';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import { assertDifficulty, assertGamemode, assertGamerule, assertPreset, assertTick, assertWeather } from '../world/validate.js';

export const worldRoutes: Router = Router();
worldRoutes.use(requireRole('admin'));

worldRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.world.read()); } catch (err) { next(err); }
});

const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});

/**
 * Chaque action : validation (400 sans trace d'audit), audit AVANT l'envoi (une commande en échec laisse une trace,
 * comme rcon.command), commande, puis état relu renvoyé au client.
 */
function action(path: string, name: AuditAction, prepare: (req: Request) => { detail: string; run: () => Promise<void> }) {
  worldRoutes.put(path, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { detail, run } = prepare(req);
      await audit(req, name, detail);
      await run();
      res.json(await req.app.locals.world.read());
    } catch (err) { next(err); }
  });
}

action('/time', 'world.time', (req) => { const preset = assertPreset(body(req).preset); return { detail: preset, run: () => req.app.locals.world.setTime(preset) }; });
action('/weather', 'world.weather', (req) => { const kind = assertWeather(body(req).kind); return { detail: kind, run: () => req.app.locals.world.setWeather(kind) }; });
action('/difficulty', 'world.difficulty', (req) => { const d = assertDifficulty(body(req).difficulty); return { detail: d, run: () => req.app.locals.world.setDifficulty(d) }; });
action('/gamemode', 'world.gamemode', (req) => { const g = assertGamemode(body(req).gamemode); return { detail: g, run: () => req.app.locals.world.setDefaultGamemode(g) }; });
action('/tick', 'world.tick', (req) => {
  const u = assertTick(req.body);
  const detail = 'rate' in u ? `rate=${u.rate}` : 'frozen' in u ? `frozen=${u.frozen}` : `sprint=${u.sprint}`;
  return { detail, run: () => req.app.locals.world.setTick(u) };
});
action('/gamerules/:name', 'world.gamerule', (req) => { const g = assertGamerule(req.params.name, body(req).value); return { detail: `${g.name}=${g.value}`, run: () => req.app.locals.world.setGamerule(g.name, g.value) }; });
```

`prepare` lève de façon synchrone à l'intérieur du `try` : une valeur invalide part en 400 par `next(err)` sans qu'aucune ligne d'audit ne soit écrite.

- [ ] **Step 4 : lancer, vérifier le succès**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/world.routes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : monter les routes et construire le service**

Dans `packages/backend/src/app.ts` : ajouter l'import `import { worldRoutes } from './routes/world.routes.js';` à la suite des autres imports de routes, puis `app.use('/api/world', worldRoutes);` juste après `app.use('/api/mods', modsRoutes);`.

Dans `packages/backend/src/index.ts` : ajouter l'import `import { WorldService } from './world/world-service.js';` et, juste après la ligne `app.locals.properties = new PropertiesService(...)` :

```ts
  // Monde (lot 5) : réglages appliqués à chaud par RCON, rien d'écrit dans /data.
  app.locals.world = new WorldService({ rcon, docker, properties: app.locals.properties });
```

- [ ] **Step 6 : typecheck, lint et suite backend complète**

Run: `pnpm --filter @mc/backend run typecheck && pnpm lint && pnpm --filter @mc/backend test`
Expected: succès. Si `app.locals.world` est refusé par le typecheck, vérifier que `app.locals` est bien typé `any` comme pour `properties` et `mods` (c'est le cas : aucun `interface Locals` dans le dépôt).

- [ ] **Step 7 : commit**

```bash
git add packages/backend/src/routes/world.routes.ts packages/backend/src/routes/world.routes.test.ts packages/backend/src/app.ts packages/backend/src/index.ts
git commit -m "feat(lot5): routes /api/world auditées

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : page Monde, API, navigation et i18n (sans cartes)

**Files:**
- Create: `packages/frontend/src/api/world.api.ts`
- Create: `packages/frontend/src/pages/World.tsx`
- Create: `packages/frontend/scripts/i18n-fragments/world.json`
- Modify: `packages/frontend/scripts/i18n-fragments/nav.json` (clé `world`)
- Modify: `packages/frontend/scripts/i18n-fragments/audit.json` (clé `actions.world`)
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx:16-17`
- Modify: `packages/frontend/src/App.tsx:40-42`
- Modify: `packages/frontend/src/pages/Audit.tsx:10`
- Test: `packages/frontend/src/pages/World.test.tsx`

**Interfaces:**
- Produces: `worldApi` (`get`, `setTime`, `setWeather`, `setDifficulty`, `setGamemode`, `setTick`, `setGamerule`, toutes → `Promise<WorldState>`) ; `WorldCardProps { state: WorldState; pending: string | null; run: (key: string, fn: () => Promise<WorldState>) => void }` dans `components/world/types.ts`, consommé par la page et par les cartes de la Task 7 ; clés i18n `world.*`.

- [ ] **Step 1 : écrire `packages/frontend/src/api/world.api.ts`**

```ts
import api from './client';
import type { Difficulty, Gamemode, TimePreset, WeatherKind, WorldState, WorldTickUpdate } from '@mc/common';

export const worldApi = {
  get: (): Promise<WorldState> => api.get('/world').then((r) => r.data),
  setTime: (preset: TimePreset): Promise<WorldState> => api.put('/world/time', { preset }).then((r) => r.data),
  setWeather: (kind: WeatherKind): Promise<WorldState> => api.put('/world/weather', { kind }).then((r) => r.data),
  setDifficulty: (difficulty: Difficulty): Promise<WorldState> => api.put('/world/difficulty', { difficulty }).then((r) => r.data),
  setGamemode: (gamemode: Gamemode): Promise<WorldState> => api.put('/world/gamemode', { gamemode }).then((r) => r.data),
  setTick: (update: WorldTickUpdate): Promise<WorldState> => api.put('/world/tick', update).then((r) => r.data),
  setGamerule: (name: string, value: boolean | number): Promise<WorldState> => api.put(`/world/gamerules/${encodeURIComponent(name)}`, { value }).then((r) => r.data),
};
```

- [ ] **Step 2 : écrire le fragment i18n `packages/frontend/scripts/i18n-fragments/world.json`**

```json
{ "namespace": "world", "keys": {
  "en": {
    "title": "World",
    "offline": "The server must be running to adjust the world.",
    "applied": "Applied",
    "unsupported": "This command is not supported by this Minecraft version.",
    "unknown": "unknown",
    "time": { "title": "Time and weather", "clock": "World time", "day": "Day {{day}}", "presets": { "day": "Day", "noon": "Noon", "night": "Night", "midnight": "Midnight" }, "freezeDaylight": "Freeze the day-night cycle" },
    "weather": { "title": "Weather", "clear": "Clear", "rain": "Rain", "thunder": "Thunder", "freeze": "Freeze the weather" },
    "tick": { "title": "Tick", "target": "Target tick rate", "rate": "Tick rate", "apply": "Apply", "normal": "Normal (20)", "freeze": "Freeze the game", "sprint": "Sprint", "sprintSeconds": "Seconds to sprint", "run": "Sprint", "sprinting": "Sprinting in progress", "unsupported": "Requires Minecraft 1.20.3 or later." },
    "rules": { "title": "Difficulty and game mode", "difficulty": "Difficulty", "gamemode": "Default game mode", "resetOnRestart": "Reset at restart by {{var}} in the container environment." },
    "gamerules": { "title": "Game rules", "apply": "Apply", "groups": { "world": "World", "players": "Players", "spawning": "Spawning", "misc": "Miscellaneous" },
      "names": {
        "doDaylightCycle": "Day-night cycle", "doWeatherCycle": "Weather cycle", "randomTickSpeed": "Random tick speed (crop growth)", "doFireTick": "Fire spreads", "mobGriefing": "Mob griefing", "doTileDrops": "Blocks drop items", "doEntityDrops": "Entities drop items", "doMobLoot": "Mobs drop loot",
        "keepInventory": "Keep inventory on death", "naturalRegeneration": "Natural regeneration", "doImmediateRespawn": "Immediate respawn", "playersSleepingPercentage": "Players needed to sleep (%)", "spawnRadius": "Spawn radius", "fallDamage": "Fall damage", "drowningDamage": "Drowning damage", "fireDamage": "Fire damage", "freezeDamage": "Freeze damage",
        "doMobSpawning": "Mob spawning", "doInsomnia": "Phantoms (insomnia)", "doPatrolSpawning": "Pillager patrols", "doTraderSpawning": "Wandering traders", "doWardenSpawning": "Warden spawning", "disableRaids": "Disable raids", "maxEntityCramming": "Max entity cramming",
        "announceAdvancements": "Announce advancements", "showDeathMessages": "Show death messages", "commandBlockOutput": "Command block output", "sendCommandFeedback": "Command feedback"
      } }
  },
  "fr": {
    "title": "Monde",
    "offline": "Le serveur doit être démarré pour ajuster le monde.",
    "applied": "Appliqué",
    "unsupported": "Commande non prise en charge par cette version de Minecraft.",
    "unknown": "inconnu",
    "time": { "title": "Heure et météo", "clock": "Heure du monde", "day": "Jour {{day}}", "presets": { "day": "Jour", "noon": "Midi", "night": "Nuit", "midnight": "Minuit" }, "freezeDaylight": "Figer le cycle jour-nuit" },
    "weather": { "title": "Météo", "clear": "Clair", "rain": "Pluie", "thunder": "Orage", "freeze": "Figer la météo" },
    "tick": { "title": "Tick", "target": "Taux de tick cible", "rate": "Taux de tick", "apply": "Appliquer", "normal": "Normal (20)", "freeze": "Geler le jeu", "sprint": "Sprint", "sprintSeconds": "Secondes à sprinter", "run": "Sprinter", "sprinting": "Sprint en cours", "unsupported": "Nécessite Minecraft 1.20.3 ou plus." },
    "rules": { "title": "Difficulté et mode de jeu", "difficulty": "Difficulté", "gamemode": "Mode de jeu par défaut", "resetOnRestart": "Réinitialisé au redémarrage par {{var}} dans l'environnement du conteneur." },
    "gamerules": { "title": "Règles du jeu", "apply": "Appliquer", "groups": { "world": "Monde", "players": "Joueurs", "spawning": "Apparition", "misc": "Divers" },
      "names": {
        "doDaylightCycle": "Cycle jour-nuit", "doWeatherCycle": "Cycle météo", "randomTickSpeed": "Vitesse des ticks aléatoires (pousse)", "doFireTick": "Propagation du feu", "mobGriefing": "Dégâts des créatures", "doTileDrops": "Les blocs lâchent des objets", "doEntityDrops": "Les entités lâchent des objets", "doMobLoot": "Butin des créatures",
        "keepInventory": "Garder l'inventaire à la mort", "naturalRegeneration": "Régénération naturelle", "doImmediateRespawn": "Réapparition immédiate", "playersSleepingPercentage": "Joueurs requis pour dormir (%)", "spawnRadius": "Rayon d'apparition", "fallDamage": "Dégâts de chute", "drowningDamage": "Dégâts de noyade", "fireDamage": "Dégâts de feu", "freezeDamage": "Dégâts de gel",
        "doMobSpawning": "Apparition des créatures", "doInsomnia": "Phantoms (insomnie)", "doPatrolSpawning": "Patrouilles de pillards", "doTraderSpawning": "Marchands ambulants", "doWardenSpawning": "Apparition du Warden", "disableRaids": "Désactiver les raids", "maxEntityCramming": "Entassement max d'entités",
        "announceAdvancements": "Annoncer les progrès", "showDeathMessages": "Afficher les messages de mort", "commandBlockOutput": "Sortie des blocs de commande", "sendCommandFeedback": "Retour des commandes"
      } }
  }
} }
```

Dans `nav.json`, ajouter `"world": "World"` (en) et `"world": "Monde"` (fr) après `"mods"`. Dans `audit.json`, ajouter `"world": "World"` (en) et `"world": "Monde"` (fr) dans `actions` après `"mods"`.

Run: `node packages/frontend/scripts/merge-i18n.mjs`
Expected: `merged: world (…)`, aucune divergence de clés.

- [ ] **Step 3 : navigation, route et filtre d'audit**

`Sidebar.tsx` : ajouter `Globe` à l'import lucide-react et, après la ligne `{ to: '/config', icon: SlidersHorizontal, label: 'nav.config', adminOnly: true },` :

```ts
    { to: '/world', icon: Globe, label: 'nav.world', adminOnly: true },
```

`App.tsx` : ajouter `const World = lazy(() => import('@/pages/World'));` à la suite des autres pages lazy, puis `<Route path="/world" element={<World />} />` après la route `/config`.

`Audit.tsx` ligne 10 : `const ACTIONS = ['', 'server', 'rcon', 'backup', 'user', 'player', 'whitelist', 'journal', 'mods', 'world'];`

- [ ] **Step 4 : écrire le test de la page**

`packages/frontend/src/pages/World.test.tsx` :

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { worldApi } from '@/api/world.api';
import World from './World';
import type { ServerStatus, WorldState } from '@mc/common';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/world.api', () => ({ worldApi: { get: vi.fn(), setTime: vi.fn(), setWeather: vi.fn(), setDifficulty: vi.fn(), setGamemode: vi.fn(), setTick: vi.fn(), setGamerule: vi.fn() } }));

export const worldState: WorldState = {
  time: { daytime: 6000, day: 12 }, tick: { supported: true, targetRate: 20, frozen: false, sprinting: false },
  difficulty: 'normal', defaultGamemode: 'survival',
  gamerules: { doDaylightCycle: true, doWeatherCycle: true, randomTickSpeed: 3, keepInventory: false, playersSleepingPercentage: 100 },
  resetOnRestart: {},
};

export function setup(role: 'admin' | 'viewer' = 'admin', status: ServerStatus = 'ready', state = worldState) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: { status, containerName: 'mc', startedAt: null } as never });
  vi.mocked(worldApi.get).mockResolvedValue(state);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/world']}><Routes><Route path="/world" element={<World />} /><Route path="/dashboard" element={<div>DASH</div>} /></Routes></MemoryRouter></QueryClientProvider>);
  return qc;
}

describe('World page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('redirects viewers', async () => {
    setup('viewer');
    expect(await screen.findByText('DASH')).toBeInTheDocument();
    expect(worldApi.get).not.toHaveBeenCalled();
  });
  it('shows the offline state without querying when the server is stopped', async () => {
    setup('admin', 'stopped');
    expect(await screen.findByText('The server must be running to adjust the world.')).toBeInTheDocument();
    expect(worldApi.get).not.toHaveBeenCalled();
  });
  it('loads the state when the server is ready and switches to offline when it stops', async () => {
    setup('admin', 'ready');
    await waitFor(() => expect(worldApi.get).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { level: 1, name: 'World' })).toBeInTheDocument();
    useServerStore.setState({ info: { status: 'stopped', containerName: 'mc', startedAt: null } as never });
    expect(await screen.findByText('The server must be running to adjust the world.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5 : lancer, vérifier l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/World.test.tsx`
Expected: FAIL, module `./World` introuvable.

- [ ] **Step 6 : écrire `components/world/types.ts` et `pages/World.tsx` (squelette sans cartes)**

`packages/frontend/src/components/world/types.ts` :

```ts
import type { WorldState } from '@mc/common';
/** Props communes aux cartes : état courant, clé du contrôle en cours, et déclencheur d'action. */
export interface WorldCardProps { state: WorldState; pending: string | null; run: (key: string, fn: () => Promise<WorldState>) => void }
```

`packages/frontend/src/pages/World.tsx` :

```tsx
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { WorldState } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';

import type { WorldCardProps } from '@/components/world/types';
type ApiError = { response?: { data?: { error?: string; code?: string } } };

export default function World() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const status = useServerStore((s) => s.info?.status);
  const online = status === 'ready' || status === 'unhealthy';
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['world'], queryFn: worldApi.get, enabled: isAdmin && online, refetchInterval: 30_000 });
  const [pending, setPending] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ fn }: { key: string; fn: () => Promise<WorldState> }) => fn(),
    onMutate: ({ key }) => setPending(key),
    onSuccess: (state) => { qc.setQueryData(['world'], state); toast.success(t('world.applied')); },
    onError: (e: ApiError) => toast.error(e.response?.data?.code === 'unsupported' ? t('world.unsupported') : e.response?.data?.error ?? t('shared.error')),
    onSettled: () => setPending(null),
  });
  const run = (key: string, fn: () => Promise<WorldState>) => mutation.mutate({ key, fn });
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('world.title')}</h1>
      {!online ? <EmptyState title={t('world.offline')} /> : isLoading || !data ? <PageLoader /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Les cartes sont ajoutées par la tâche suivante ; `run` et `pending` leur sont transmis. */}
          <WorldCards state={data} pending={pending} run={run} />
        </div>
      )}
    </div>
  );
}

function WorldCards(_props: WorldCardProps) { return null; }
```

- [ ] **Step 7 : lancer, vérifier le succès**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/World.test.tsx`
Expected: PASS (3 tests). Si le lint refuse `_props`, nommer le paramètre `props` et l'utiliser (`void props`) : ce placeholder disparaît à la Task 7.

- [ ] **Step 8 : typecheck et commit**

Run: `pnpm --filter @mc/frontend run typecheck`
Expected: succès.

```bash
git add packages/frontend/src/api/world.api.ts packages/frontend/src/components/world/types.ts packages/frontend/src/pages/World.tsx packages/frontend/src/pages/World.test.tsx packages/frontend/scripts/i18n-fragments/world.json packages/frontend/scripts/i18n-fragments/nav.json packages/frontend/scripts/i18n-fragments/audit.json packages/frontend/src/i18n/locales/fr.json packages/frontend/src/i18n/locales/en.json packages/frontend/src/components/layout/Sidebar.tsx packages/frontend/src/App.tsx packages/frontend/src/pages/Audit.tsx
git commit -m "feat(lot5): page Monde, API et navigation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : les quatre cartes de la page Monde

**Files:**
- Create: `packages/frontend/src/components/world/TimeWeatherCard.tsx`
- Create: `packages/frontend/src/components/world/TickCard.tsx`
- Create: `packages/frontend/src/components/world/RulesCard.tsx`
- Create: `packages/frontend/src/components/world/GamerulesCard.tsx`
- Create: `packages/frontend/src/components/world/world-time.ts`
- Test: `packages/frontend/src/components/world/world-time.test.ts`
- Modify: `packages/frontend/src/pages/World.tsx` (remplacer `WorldCards`)
- Modify: `packages/frontend/src/pages/World.test.tsx`

**Interfaces:**
- Consumes: `WorldCardProps` de `components/world/types.ts`, `worldApi`, catalogue `@mc/common`.
- Produces: `formatWorldTime(daytime: number): string` (`HH:MM`, 0 → `06:00`).

- [ ] **Step 1 : test de l'horloge**

`packages/frontend/src/components/world/world-time.test.ts` :

```ts
import { formatWorldTime } from './world-time';

describe('formatWorldTime', () => {
  it('maps game ticks to a 24h clock starting at 06:00', () => {
    expect(formatWorldTime(0)).toBe('06:00');
    expect(formatWorldTime(6000)).toBe('12:00');
    expect(formatWorldTime(13000)).toBe('19:00');
    expect(formatWorldTime(18000)).toBe('00:00');
    expect(formatWorldTime(23999)).toBe('05:59');
    expect(formatWorldTime(500)).toBe('06:30');
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec, écrire `world-time.ts`**

Run: `pnpm --filter @mc/frontend exec vitest run src/components/world/world-time.test.ts` → FAIL (module introuvable).

```ts
/** daytime 0..23999 → HH:MM ; 0 tick = 06:00, 1000 ticks = une heure. */
export function formatWorldTime(daytime: number): string {
  const totalMinutes = Math.floor((((daytime % 24000) + 24000) % 24000) * 60 / 1000);
  const h = (Math.floor(totalMinutes / 60) + 6) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
```

Run à nouveau → PASS.

- [ ] **Step 3 : étendre `World.test.tsx` avec les cartes**

Ajouter aux imports : `import { fireEvent } from '@testing-library/react';` (fusionner avec l'import existant) et en fin de fichier :

```tsx
describe('World cards', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the clock and applies a time preset, replacing the cached state', async () => {
    setup();
    expect(await screen.findByText('12:00')).toBeInTheDocument();
    expect(screen.getByText('Day 12')).toBeInTheDocument();
    vi.mocked(worldApi.setTime).mockResolvedValue({ ...worldState, time: { daytime: 13000, day: 12 } });
    fireEvent.click(screen.getByRole('button', { name: 'Night' }));
    await waitFor(() => expect(worldApi.setTime).toHaveBeenCalledWith('night'));
    expect(await screen.findByText('19:00')).toBeInTheDocument();
  });
  it('freezing the daylight cycle sets doDaylightCycle to false', async () => {
    setup();
    const sw = await screen.findByRole('switch', { name: 'Freeze the day-night cycle' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    vi.mocked(worldApi.setGamerule).mockResolvedValue({ ...worldState, gamerules: { ...worldState.gamerules, doDaylightCycle: false } });
    fireEvent.click(sw);
    await waitFor(() => expect(worldApi.setGamerule).toHaveBeenCalledWith('doDaylightCycle', false));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });
  it('sends the weather and the tick rate', async () => {
    setup();
    vi.mocked(worldApi.setWeather).mockResolvedValue(worldState);
    vi.mocked(worldApi.setTick).mockResolvedValue({ ...worldState, tick: { ...worldState.tick, targetRate: 40 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Rain' }));
    await waitFor(() => expect(worldApi.setWeather).toHaveBeenCalledWith('rain'));
    fireEvent.change(screen.getByLabelText('Tick rate'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    await waitFor(() => expect(worldApi.setTick).toHaveBeenCalledWith({ rate: 40 }));
  });
  it('sprint converts seconds to ticks', async () => {
    setup();
    vi.mocked(worldApi.setTick).mockResolvedValue(worldState);
    fireEvent.change(await screen.findByLabelText('Seconds to sprint'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sprint' }));
    await waitFor(() => expect(worldApi.setTick).toHaveBeenCalledWith({ sprint: 1200 }));
  });
  it('disables the tick card when unsupported', async () => {
    setup('admin', 'ready', { ...worldState, tick: { supported: false, targetRate: null, frozen: false, sprinting: false } });
    expect(await screen.findByText('Requires Minecraft 1.20.3 or later.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tick rate')).toBeDisabled();
  });
  it('shows the reset-at-restart hint for difficulty', async () => {
    setup('admin', 'ready', { ...worldState, resetOnRestart: { difficulty: 'DIFFICULTY' } });
    expect(await screen.findByText(/Reset at restart by DIFFICULTY/)).toBeInTheDocument();
  });
  it('applies an integer gamerule and shows unknown values', async () => {
    setup('admin', 'ready', { ...worldState, gamerules: { ...worldState.gamerules, randomTickSpeed: null } });
    const input = await screen.findByLabelText('Random tick speed (crop growth)');
    expect(input).toHaveValue(null);
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
    vi.mocked(worldApi.setGamerule).mockResolvedValue({ ...worldState, gamerules: { ...worldState.gamerules, randomTickSpeed: 10 } });
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply randomTickSpeed' }));
    await waitFor(() => expect(worldApi.setGamerule).toHaveBeenCalledWith('randomTickSpeed', 10));
  });
});
```

- [ ] **Step 4 : lancer, vérifier l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/World.test.tsx`
Expected: FAIL, `12:00` introuvable.

- [ ] **Step 5 : écrire `TimeWeatherCard.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { TIME_PRESETS, WEATHER_KINDS } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorldCardProps } from './types';
import { formatWorldTime } from './world-time';

export function TimeWeatherCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  const daylight = state.gamerules.doDaylightCycle;
  const weather = state.gamerules.doWeatherCycle;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.time.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-3">
          <span className="text-xs text-muted-foreground">{t('world.time.clock')}</span>
          <span className="font-mono text-2xl">{state.time.daytime === null ? t('world.unknown') : formatWorldTime(state.time.daytime)}</span>
          {state.time.day !== null && <span className="text-xs text-muted-foreground">{t('world.time.day', { day: state.time.day })}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {TIME_PRESETS.map((p) => <Button key={p} size="sm" variant="outline" disabled={pending === `time:${p}`} onClick={() => run(`time:${p}`, () => worldApi.setTime(p))}>{t(`world.time.presets.${p}`)}</Button>)}
        </div>
        <div className="flex items-center gap-3">
          <Switch id="freeze-daylight" aria-label={t('world.time.freezeDaylight')} checked={daylight === false} disabled={pending === 'gamerule:doDaylightCycle'} onCheckedChange={(v) => run('gamerule:doDaylightCycle', () => worldApi.setGamerule('doDaylightCycle', !v))} />
          <Label htmlFor="freeze-daylight" className="text-xs">{t('world.time.freezeDaylight')}</Label>
        </div>
        <h3 className="text-sm font-medium">{t('world.weather.title')}</h3>
        <div className="flex flex-wrap gap-2">
          {WEATHER_KINDS.map((k) => <Button key={k} size="sm" variant="outline" disabled={pending === `weather:${k}`} onClick={() => run(`weather:${k}`, () => worldApi.setWeather(k))}>{t(`world.weather.${k}`)}</Button>)}
        </div>
        <div className="flex items-center gap-3">
          <Switch id="freeze-weather" aria-label={t('world.weather.freeze')} checked={weather === false} disabled={pending === 'gamerule:doWeatherCycle'} onCheckedChange={(v) => run('gamerule:doWeatherCycle', () => worldApi.setGamerule('doWeatherCycle', !v))} />
          <Label htmlFor="freeze-weather" className="text-xs">{t('world.weather.freeze')}</Label>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6 : écrire `TickCard.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TICK_RATE, TICK_SPRINT_MAX } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorldCardProps } from './types';

export function TickCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  const [rate, setRate] = useState('');
  const [seconds, setSeconds] = useState('');
  const { supported, targetRate, frozen, sprinting } = state.tick;
  const rateNum = Number(rate);
  const rateOk = rate !== '' && Number.isFinite(rateNum) && rateNum >= TICK_RATE.min && rateNum <= TICK_RATE.max;
  const secNum = Number(seconds);
  const secOk = seconds !== '' && Number.isInteger(secNum) && secNum >= 1 && secNum * 20 <= TICK_SPRINT_MAX;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.tick.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!supported && <p className="text-xs text-muted-foreground">{t('world.tick.unsupported')}</p>}
        <div className="flex items-baseline gap-3">
          <span className="text-xs text-muted-foreground">{t('world.tick.target')}</span>
          <span className="font-mono text-2xl">{targetRate ?? t('world.unknown')}</span>
          {sprinting && <span className="text-xs text-amber-500">{t('world.tick.sprinting')}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tick-rate" className="w-32 shrink-0 text-xs">{t('world.tick.rate')}</Label>
          <Input id="tick-rate" type="number" className="h-8 w-28" min={TICK_RATE.min} max={TICK_RATE.max} step="any" value={rate} disabled={!supported} onChange={(e) => setRate(e.target.value)} />
          <Button size="sm" disabled={!supported || !rateOk || pending === 'tick:rate'} onClick={() => run('tick:rate', () => worldApi.setTick({ rate: rateNum }))}>{t('world.tick.apply')}</Button>
          <Button size="sm" variant="outline" disabled={!supported || targetRate === TICK_RATE.default || pending === 'tick:rate'} onClick={() => run('tick:rate', () => worldApi.setTick({ rate: TICK_RATE.default }))}>{t('world.tick.normal')}</Button>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="tick-freeze" aria-label={t('world.tick.freeze')} checked={frozen} disabled={!supported || pending === 'tick:frozen'} onCheckedChange={(v) => run('tick:frozen', () => worldApi.setTick({ frozen: v }))} />
          <Label htmlFor="tick-freeze" className="text-xs">{t('world.tick.freeze')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tick-sprint" className="w-32 shrink-0 text-xs">{t('world.tick.sprintSeconds')}</Label>
          <Input id="tick-sprint" type="number" className="h-8 w-28" min={1} max={TICK_SPRINT_MAX / 20} value={seconds} disabled={!supported} onChange={(e) => setSeconds(e.target.value)} />
          <Button size="sm" disabled={!supported || !secOk || pending === 'tick:sprint'} onClick={() => run('tick:sprint', () => worldApi.setTick({ sprint: secNum * 20 }))}>{t('world.tick.run')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7 : écrire `RulesCard.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { DIFFICULTIES, GAMEMODES, type Difficulty, type Gamemode } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { WorldCardProps } from './types';

export function RulesCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.rules.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label htmlFor="world-difficulty" className="w-40 shrink-0 text-xs">{t('world.rules.difficulty')}</Label>
            <Select value={state.difficulty ?? undefined} disabled={pending === 'difficulty'} onValueChange={(v) => run('difficulty', () => worldApi.setDifficulty(v as Difficulty))}>
              <SelectTrigger id="world-difficulty" aria-label={t('world.rules.difficulty')} className="h-8 w-48"><SelectValue placeholder={t('world.unknown')} /></SelectTrigger>
              <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {state.resetOnRestart.difficulty && <p className="pl-40 text-xs text-amber-500">{t('world.rules.resetOnRestart', { var: state.resetOnRestart.difficulty })}</p>}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Label htmlFor="world-gamemode" className="w-40 shrink-0 text-xs">{t('world.rules.gamemode')}</Label>
            <Select value={state.defaultGamemode ?? undefined} disabled={pending === 'gamemode'} onValueChange={(v) => run('gamemode', () => worldApi.setGamemode(v as Gamemode))}>
              <SelectTrigger id="world-gamemode" aria-label={t('world.rules.gamemode')} className="h-8 w-48"><SelectValue placeholder={t('world.unknown')} /></SelectTrigger>
              <SelectContent>{GAMEMODES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {state.resetOnRestart.gamemode && <p className="pl-40 text-xs text-amber-500">{t('world.rules.resetOnRestart', { var: state.resetOnRestart.gamemode })}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8 : écrire `GamerulesCard.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GAMERULES, GAMERULE_GROUPS, type GameruleDef } from '@mc/common';
import { worldApi } from '@/api/world.api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { WorldCardProps } from './types';

function IntRule({ def, value, pending, run }: { def: GameruleDef; value: number | null } & Pick<WorldCardProps, 'pending' | 'run'>) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : String(value));
  const n = Number(shown);
  const ok = shown !== '' && Number.isInteger(n) && (def.min === undefined || n >= def.min) && (def.max === undefined || n <= def.max) && n !== value;
  const key = `gamerule:${def.name}`;
  const label = t(`world.gamerules.names.${def.name}`);
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={`gr-${def.name}`} className="w-56 shrink-0 text-xs">{label}</Label>
      <Input id={`gr-${def.name}`} type="number" className="h-8 w-24" min={def.min} max={def.max} value={shown} onChange={(e) => setDraft(e.target.value)} />
      {value === null && <span className="text-xs text-muted-foreground">{t('world.unknown')}</span>}
      <Button size="sm" variant="outline" aria-label={`${t('world.gamerules.apply')} ${def.name}`} disabled={!ok || pending === key} onClick={() => run(key, async () => { const s = await worldApi.setGamerule(def.name, n); setDraft(null); return s; })}>{t('world.gamerules.apply')}</Button>
    </div>
  );
}

export function GamerulesCard({ state, pending, run }: WorldCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3"><CardTitle className="text-base">{t('world.gamerules.title')}</CardTitle></CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        {GAMERULE_GROUPS.map((group) => (
          <section key={group} className="space-y-3">
            <h3 className="text-sm font-medium">{t(`world.gamerules.groups.${group}`)}</h3>
            {GAMERULES.filter((g) => g.group === group).map((def) => {
              const value = state.gamerules[def.name] ?? null;
              if (def.type === 'int') return <IntRule key={def.name} def={def} value={typeof value === 'number' ? value : null} pending={pending} run={run} />;
              const key = `gamerule:${def.name}`; const label = t(`world.gamerules.names.${def.name}`);
              return (
                <div key={def.name} className="flex items-center gap-3">
                  <Switch id={`gr-${def.name}`} aria-label={label} checked={value === true} disabled={pending === key} onCheckedChange={(v) => run(key, () => worldApi.setGamerule(def.name, v))} />
                  <Label htmlFor={`gr-${def.name}`} className="text-xs">{label}</Label>
                  {value === null && <span className="text-xs text-muted-foreground">{t('world.unknown')}</span>}
                </div>
              );
            })}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 9 : brancher les cartes dans `World.tsx`**

Remplacer la fonction `WorldCards` et son usage par :

```tsx
import { TimeWeatherCard } from '@/components/world/TimeWeatherCard';
import { TickCard } from '@/components/world/TickCard';
import { RulesCard } from '@/components/world/RulesCard';
import { GamerulesCard } from '@/components/world/GamerulesCard';
// …
        <div className="grid gap-4 lg:grid-cols-2">
          <TimeWeatherCard state={data} pending={pending} run={run} />
          <TickCard state={data} pending={pending} run={run} />
          <RulesCard state={data} pending={pending} run={run} />
          <GamerulesCard state={data} pending={pending} run={run} />
        </div>
```

Supprimer la fonction `WorldCards` et son commentaire.

- [ ] **Step 10 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/World.test.tsx src/components/world && pnpm --filter @mc/frontend run typecheck && pnpm lint`
Expected: PASS (10 tests World + 1 world-time), typecheck et lint propres. Si un test sur le `Switch` échoue sur `aria-checked`, vérifier que le composant shadcn rend bien `role="switch"` (c'est le cas de `PropertiesForm.test` existant).

- [ ] **Step 11 : commit**

```bash
git add packages/frontend/src/components/world packages/frontend/src/pages/World.tsx packages/frontend/src/pages/World.test.tsx
git commit -m "feat(lot5): cartes heure, météo, tick, règles et gamerules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : explication du cadenas sur Configuration

**Files:**
- Modify: `packages/frontend/scripts/i18n-fragments/config.json` (`lockedBy`, nouvelle clé `lockedHint`)
- Modify: `packages/frontend/src/components/config/PropertiesForm.tsx`
- Modify: `packages/frontend/src/pages/Config.test.tsx:34`

- [ ] **Step 1 : mettre à jour le test existant**

Dans `Config.test.tsx`, test « renders the form with a locked field… », remplacer `expect(screen.getByTitle(/container variable MOTD/)).toBeInTheDocument();` par :

```tsx
    expect(screen.getByTitle(/Managed by MOTD in the container environment.*OVERRIDE_SERVER_PROPERTIES=false/)).toBeInTheDocument();
    expect(screen.getByText(/Some keys are locked because the container environment sets them/)).toBeInTheDocument();
```

et ajouter un test :

```tsx
  it('hides the lock hint when only RCON keys are locked', async () => {
    setup('admin', { ...view, locked: { 'rcon.password': 'rcon', 'rcon.port': 'rcon', 'enable-rcon': 'rcon' } });
    await screen.findByLabelText('Message of the day');
    expect(screen.queryByText(/Some keys are locked/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Config.test.tsx`
Expected: FAIL sur les deux assertions nouvelles.

- [ ] **Step 3 : fragment i18n**

Dans `config.json`, remplacer `lockedBy` et ajouter `lockedHint` :

- en : `"lockedBy": "Managed by {{var}} in the container environment. Set OVERRIDE_SERVER_PROPERTIES=false in the Minecraft stack to make this file authoritative."`, `"lockedHint": "Some keys are locked because the container environment sets them at each start. Set OVERRIDE_SERVER_PROPERTIES=false in the Minecraft stack (or remove those variables) to edit them here."`
- fr : `"lockedBy": "Gérée par {{var}} dans l'environnement du conteneur. Définissez OVERRIDE_SERVER_PROPERTIES=false dans la stack Minecraft pour rendre ce fichier maître."`, `"lockedHint": "Certaines clés sont verrouillées parce que l'environnement du conteneur les impose à chaque démarrage. Définissez OVERRIDE_SERVER_PROPERTIES=false dans la stack Minecraft (ou retirez ces variables) pour les modifier ici."`

Run: `node packages/frontend/scripts/merge-i18n.mjs`

- [ ] **Step 4 : ligne d'information dans `PropertiesForm.tsx`**

Au début du JSX retourné (avant le `map` des groupes), dans le `div.space-y-6` :

```tsx
      {Object.values(locked).some((v) => v !== 'rcon') && (
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('config.lockedHint')}</span>
        </p>
      )}
```

- [ ] **Step 5 : lancer, vérifier le succès, commit**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Config.test.tsx`
Expected: PASS.

```bash
git add packages/frontend/scripts/i18n-fragments/config.json packages/frontend/src/i18n/locales/fr.json packages/frontend/src/i18n/locales/en.json packages/frontend/src/components/config/PropertiesForm.tsx packages/frontend/src/pages/Config.test.tsx
git commit -m "feat(lot5): expliquer comment libérer les clés cadenassées par l'environnement

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : documentation et vérification complète

**Files:**
- Modify: `README.md` (nouvelle section `## World` après `## Server configuration`, lignes 130-137)
- Modify: `CLAUDE.md` (architecture backend après le point Mods, architecture frontend, invariants)

- [ ] **Step 1 : README**

Insérer après la section « Server configuration » :

```markdown
## World

The World page (admin only) adjusts the running world through RCON, without a restart: time of day and weather (with "freeze" switches backed by `doDaylightCycle` / `doWeatherCycle`), tick rate, freeze and sprint (`/tick`, Minecraft 1.20.3+), difficulty, default game mode and a curated list of game rules.

- Every action is a single validated command, audited as `world.*` before it is sent. Nothing is written to `/data` by MC Manager: the server persists these values in the world itself.
- Difficulty and default game mode are also written to `server.properties` by the server. If `DIFFICULTY` or `MODE` is set in the container environment, the itzg image resets them at the next start; the page says so.
- The weather has no read command in vanilla, so no current state is shown for it.
```

Dans la section « Server configuration », compléter le premier point : « The form shows a hint explaining this whenever a locked key is present. »

- [ ] **Step 2 : CLAUDE.md**

Architecture backend, après le point « Mods (lot 3) » :

```markdown
- **Monde (lot 5)** : `world/world-service.ts` lit (`read()` : `time query daytime|day`, `tick query`, `difficulty`, un `gamerule <nom>` par entrée de `GAMERULES`, `gamemode` relu dans `server.properties`, `resetOnRestart` via `lockedKeys`) et applique à chaud (`setTime`, `setWeather`, `setDifficulty`, `setDefaultGamemode`, `setTick`, `setGamerule`) ; `world/validate.ts` contraint chaque valeur au catalogue de `@mc/common` (`TIME_PRESETS`, `WEATHER_KINDS`, `DIFFICULTIES`, `GAMEMODES`, `TICK_RATE`, `TICK_SPRINT_MAX`, `GAMERULES`) avant tout envoi ; `world/parsers.ts` est tolérant (`null` si réponse non reconnue, `tick.supported = false` avant 1.20.3). Seuls les motifs d'erreur des réponses sont interprétés : 501 `unsupported` si commande inconnue, 502 sinon ; réponse vide = succès puis relecture. Routes `/api/world` (admin, audit `world.*` avant envoi, `PUT` renvoie l'état relu). Rien d'écrit dans `/data`, pas de WebSocket.
```

Architecture frontend, après le point sur `/mods` :

```markdown
- Page `/world` (`pages/World.tsx`, cartes `components/world/`) : query `world` activée seulement si le serveur est `ready` ou `unhealthy`, `refetchInterval` 30 s (donnée non poussée), chaque mutation remplace le cache par l'état renvoyé ; `pending` désactive le seul contrôle en cours. Le cadenas de `PropertiesForm` explique `OVERRIDE_SERVER_PROPERTIES=false`.
```

Invariants de sécurité, après le point sur le volume de données : « Le lot 5 n'écrit rien dans `/data` ; ses commandes RCON sont construites uniquement à partir du catalogue de `@mc/common`. »

- [ ] **Step 3 : chaîne CI locale**

Run: `pnpm db:generate && pnpm --filter @mc/common run build && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tout vert.

- [ ] **Step 4 : commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(lot5): page Monde et cadenas de configuration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5 : vérification manuelle sur le serveur réel (hors tests automatisés, à faire par le mainteneur)**

1. Lancer `pnpm dev`, ouvrir `/world` en admin avec le serveur `ready` : les quatre cartes se remplissent.
2. Dans la console, envoyer `tick freeze` puis `tick query`, noter la sortie exacte ; recharger `/world` et vérifier que « Geler le jeu » est coché. Si l'état n'apparaît pas, ajuster les regex de `parseTickStatus` à partir de la sortie notée et ajouter la chaîne au test de la Task 2.
3. Même chose pour `tick sprint 1200` puis `tick query`.
4. Basculer `keepInventory` depuis la page, vérifier la ligne `world.gamerule keepInventory=true` dans l'audit et la réponse `gamerule keepInventory` dans la console.
5. Ajouter `OVERRIDE_SERVER_PROPERTIES: "false"` à l'environnement du conteneur Minecraft dans le compose de production, recréer le conteneur, vérifier que les cadenas MOTD, DIFFICULTY, etc. disparaissent de Configuration et que le sous-texte « réinitialisé au redémarrage » disparaît de la carte Difficulté.
