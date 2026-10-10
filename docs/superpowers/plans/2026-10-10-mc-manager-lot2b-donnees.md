# MC Manager Lot 2b « Données du serveur » Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurer un backup depuis l'interface (sauvegarde de sécurité, arrêt, remplacement, redémarrage, progression en direct) et éditer `server.properties` (formulaire + brut, clés verrouillées par l'environnement itzg).

**Architecture:** Le backend monte désormais `/data` en écriture (approche B). Un verrou global `DataLock` sérialise sauvegarde manuelle, restauration et écriture de `server.properties`. `RestoreService` enchaîne les étapes et diffuse `restore.progress`/`restore.done` ; l'extraction passe par la bibliothèque `tar` derrière un filtre d'entrées strict. `PropertiesService` lit, fusionne et écrit le fichier de façon atomique, avec les clés verrouillées calculées depuis `Config.Env` du conteneur Minecraft. Le frontend ajoute le dialogue de restauration sur la page Sauvegardes et une page Configuration.

**Tech Stack:** Node 22, Express 4, Prisma 6, `tar` ^7 (npm), dockerode, vitest + supertest ; React 18, TanStack Query 5, i18next.

**Spec:** `docs/superpowers/specs/2026-10-10-mc-manager-lot2b-donnees-design.md`

## Global Constraints

- Les seules écritures dans `config.mc.dataDir` sont la restauration (`RestoreService`) et `server.properties` (`PropertiesService`), toutes deux admin, auditées et sous `DataLock`. Aucune autre écriture.
- `DataLock` : `acquire(op)` lève `AppError(409, 'Another operation is running: <op>')` si pris ; libéré en `finally`, jamais persistant.
- Archives restaurables : gzip seulement (`.tgz`, `.tar.gz`), vérifiées par les deux octets magiques `1f 8b` ; autres formats → 400 `Unsupported archive format (gzip only)`.
- Filtre d'archive : chemin normalisé sans `./` ; refus des chemins vides, absolus, contenant un segment `..` ou `\0` ; types acceptés `File`, `OldFile`, `ContiguousFile`, `Directory` ; liens symboliques, durs et périphériques refusés ; limites 200 000 entrées et 20 Go décompressés. Tout refus survient en `check`, avant toute écriture.
- Sémantique de restauration : chaque entrée de premier niveau de l'archive remplace son homologue dans `dataDir` (`rm -rf`) avant l'extraction ; le reste est conservé.
- Sauvegarde de sécurité : obligatoire si le serveur est `ready`/`unhealthy` (échec = annulation sans rien toucher) ; serveur arrêté sans `confirmNoSafetyBackup: true` → 409 avant le 202.
- Attente d'arrêt : 90 s maximum (injectable), sinon annulation sans rien toucher.
- Audit : `backup.restore` (détail = nom) avant l'arrêt, puis `backup.restore` `exit ok` / `failed: <message>` ; `server.properties` (détail = clés changées ou `raw (<n> lignes)`) avant l'écriture.
- Clés toujours verrouillées : `enable-rcon`, `rcon.port`, `rcon.password` ; la valeur de `rcon.password` n'est jamais renvoyée (masquée `********`) ni modifiable.
- Clés verrouillées par l'environnement : table 4.3 de la spec, sauf si `OVERRIDE_SERVER_PROPERTIES=false` est présent dans `Config.Env`.
- Validation `server.properties` : clés `^[a-z0-9._-]+$`, valeurs sur une ligne, 64 Ko maximum, écriture atomique (fichier temporaire + `rename`).
- Messages WebSocket : `restore.progress { step, line }`, `restore.done { ok, message, safetyBackup }`.
- i18n via fragments + `node packages/frontend/scripts/merge-i18n.mjs` ; pas de `refetchInterval`.
- Fichiers existants en CRLF : outil Edit, jamais de réécriture complète ni de sed multi-lignes.
- Chaque tâche : `pnpm typecheck`, tests du package touché, commit. Commits terminés par les deux lignes d'attribution de la session.

## Review Focus

1. Archive dont une entrée est `./world/../../etc/passwd` : refus en `check`, rien d'écrit (test en tâche 2).
2. Serveur qui ne s'arrête pas dans le délai : la restauration s'annule sans toucher aux données et l'interface affiche l'échec (test en tâche 3).
3. Deux admins cliquent « Restaurer » puis « Sauvegarder maintenant » en même temps : le second reçoit 409, jamais deux écritures concurrentes (tests en tâches 1 et 4).
4. `server.properties` avec `MOTD` défini dans le compose : l'enregistrement de `motd` est refusé en 409 avec le nom de la variable, et le formulaire l'affiche verrouillé (tests en tâches 5, 6 et 8).
5. Fichier `server.properties` appartenant à root : l'écriture renvoie un message nommant le chemin et la commande `chown`, pas un « Internal server error » (test en tâche 6).

---

## File Structure

**Backend (`packages/backend/src/`)**

| Fichier | Responsabilité |
|---|---|
| `data/data-lock.ts` | `DataLock` |
| `backups/backup-service.ts` (modif.) | `runNow` et `remove` sous `DataLock` |
| `backups/archive-filter.ts` | `normalizeEntryPath`, `validateEntry`, `inspectArchive`, `restoreArchive` |
| `backups/restore-service.ts` | `RestoreService` (machine à états) |
| `routes/backups.routes.ts` (modif.) | `POST /:name/restore`, `GET /restore/status`, 409 sous verrou |
| `server-properties/itzg-env.ts` | table clé → variable, `lockedKeys` |
| `utils/server-properties.ts` (modif.) | `escapeValue`, `updateServerProperties`, `validateRawProperties`, `maskRconPassword` |
| `server-properties/properties-service.ts` | `PropertiesService` (lecture, écriture atomique, `restartRequired`) |
| `routes/properties.routes.ts` | `GET/PUT /api/server/properties` |
| `docker/docker-like.ts`, `docker-service.ts`, `fake-docker.ts` (modif.) | `Config.Env` dans l'inspection, `serverEnv()` |
| `index.ts`, `app.ts` (modif.) | câblage |

**Common** : `types/backups.ts` (+ `RestoreStep`, `RestoreStatus`, `RestoreRequest`), `types/properties.ts`, `ws-messages.ts`, `types/audit.ts` (+ `backup.restore`, `server.properties`).

**Frontend (`packages/frontend/src/`)**

| Fichier | Responsabilité |
|---|---|
| `api/backups.api.ts` (modif.), `api/config.api.ts` | clients |
| `stores/server.store.ts` (modif.) | état de restauration |
| `components/backups/RestoreDialog.tsx`, `BackupTable.tsx` (modif.), `BackupRunPanel.tsx` (modif.), `pages/Backups.tsx` (modif.) | restauration |
| `pages/Config.tsx`, `components/config/PropertiesForm.tsx`, `components/config/PropertiesRaw.tsx`, `components/config/RestartBanner.tsx` | éditeur |
| `components/layout/Sidebar.tsx`, `App.tsx`, `hooks/use-websocket.ts` (modif.) | navigation, invalidations |

---

### Task 1: Verrou global, types partagés, dépendance tar

**Files:**
- Create: `packages/backend/src/data/data-lock.ts`
- Modify: `packages/backend/src/backups/backup-service.ts`, `packages/backend/package.json`
- Modify: `packages/common/src/types/backups.ts`, `packages/common/src/types/audit.ts`, `packages/common/src/ws-messages.ts`, `packages/common/src/index.ts`
- Create: `packages/common/src/types/properties.ts`
- Test: `packages/backend/src/data/data-lock.test.ts`, `packages/backend/src/backups/backup-service.test.ts` (ajout)

**Interfaces:**
- Produces: `class DataLock { busy: DataOp | null; acquire(op: DataOp): () => void; assertFree(): void }`, `type DataOp = 'backup' | 'restore' | 'properties'` ; `BackupService` prend un troisième paramètre optionnel `lock: DataLock` (défaut `new DataLock()`), `runNow(opts?: { lockHeld?: boolean })`, `remove(name)` lève 409 sous verrou ; types communs ci-dessous.

- [ ] **Step 1: Types communs**

Ajouter à `packages/common/src/types/backups.ts` :

```ts
export type RestoreStep = 'check' | 'safety' | 'stop' | 'replace' | 'extract' | 'start';
export interface RestoreStatus { running: boolean; step: RestoreStep | null }
export interface RestoreRequest { startAfter?: boolean; confirmNoSafetyBackup?: boolean }
export interface RestoreResult { ok: boolean; message: string; safetyBackup: string | null }
```

Créer `packages/common/src/types/properties.ts` :

```ts
export interface ServerPropertiesView {
  /** Contenu du fichier, mot de passe RCON masqué. */
  raw: string;
  values: Record<string, string>;
  /** clé → variable d'environnement itzg qui la gouverne (ou 'rcon' pour les clés RCON). */
  locked: Record<string, string>;
  exists: boolean;
  restartRequired: boolean;
}
export type ServerPropertiesUpdate = { values: Record<string, string> } | { raw: string };
```

Dans `packages/common/src/index.ts`, ajouter `export * from './types/properties.js';`.

Dans `packages/common/src/types/audit.ts`, ajouter à l'union `AuditAction` (avant `| 'journal.retention'`) : `| 'backup.restore' | 'server.properties'`.

Dans `packages/common/src/ws-messages.ts`, remplacer l'import et l'union par :

```ts
import type { ServerInfo } from './types/server.js';
import type { OnlinePlayer } from './types/players.js';
import type { RestoreStep } from './types/backups.js';
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
  | { type: 'player.lists.changed' }
  | { type: 'restore.progress'; step: RestoreStep; line: string }
  | { type: 'restore.done'; ok: boolean; message: string; safetyBackup: string | null };
```

Puis `pnpm --filter @mc/common run build`.

- [ ] **Step 2: Dépendance tar**

```bash
pnpm --filter @mc/backend add tar@^7.5.0
```

(`tar` 7 embarque ses propres types ; aucun `@types/tar`.)

- [ ] **Step 3: Test du verrou (échec attendu)**

Créer `packages/backend/src/data/data-lock.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { DataLock } from './data-lock.js';
import { AppError } from '../middleware/error-handler.js';

describe('DataLock', () => {
  it('is free by default and reports the holder', () => {
    const lock = new DataLock();
    expect(lock.busy).toBeNull();
    const release = lock.acquire('restore');
    expect(lock.busy).toBe('restore');
    release();
    expect(lock.busy).toBeNull();
  });
  it('refuses a second acquire with 409 naming the running operation', () => {
    const lock = new DataLock();
    lock.acquire('backup');
    const err = (() => { try { lock.acquire('restore'); return null; } catch (e) { return e as AppError; } })();
    expect(err).toBeInstanceOf(AppError);
    expect(err?.statusCode).toBe(409);
    expect(err?.message).toBe('Another operation is running: backup');
  });
  it('assertFree throws only while busy', () => {
    const lock = new DataLock();
    expect(() => lock.assertFree()).not.toThrow();
    const release = lock.acquire('properties');
    expect(() => lock.assertFree()).toThrow(AppError);
    release();
    expect(() => lock.assertFree()).not.toThrow();
  });
  it('release is idempotent and never frees a later holder', () => {
    const lock = new DataLock();
    const r1 = lock.acquire('backup');
    r1(); r1();
    const r2 = lock.acquire('restore');
    r1();
    expect(lock.busy).toBe('restore');
    r2();
    expect(lock.busy).toBeNull();
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/data/data-lock.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 4: DataLock**

Créer `packages/backend/src/data/data-lock.ts` :

```ts
import { AppError } from '../middleware/error-handler.js';

export type DataOp = 'backup' | 'restore' | 'properties';

/**
 * Verrou global des écritures dans /data et des sauvegardes : une seule opération à la fois.
 * Jamais persistant : un processus qui redémarre repart libre.
 */
export class DataLock {
  private current: DataOp | null = null;
  private token = 0;

  get busy(): DataOp | null { return this.current; }

  assertFree(): void {
    if (this.current) throw new AppError(409, `Another operation is running: ${this.current}`);
  }

  /** Prend le verrou ou lève 409 ; renvoie la fonction de libération (idempotente, liée à cette prise). */
  acquire(op: DataOp): () => void {
    this.assertFree();
    this.current = op;
    const mine = ++this.token;
    return () => { if (this.token === mine && this.current !== null) this.current = null; };
  }
}
```

Run: `pnpm --filter @mc/backend exec vitest run src/data/data-lock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Test de BackupService sous verrou (échec attendu)**

Ajouter à la fin de `packages/backend/src/backups/backup-service.test.ts` (dans le `describe('BackupService')`, après les tests existants) :

```ts
  it('runNow takes the data lock and answers 409 while another operation holds it', async () => {
    const lock = new DataLock();
    const locked = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'), lock);
    const release = lock.acquire('restore');
    await expect(locked.runNow()).rejects.toMatchObject({ statusCode: 409 });
    release();
    const p = locked.runNow();
    expect(lock.busy).toBe('backup');
    backupContainer.execStream.end('done\n');
    await p;
    expect(lock.busy).toBeNull();
  });
  it('runNow with lockHeld does not take the lock (used by the restore safety backup)', async () => {
    const lock = new DataLock();
    const locked = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'), lock);
    lock.acquire('restore');
    const p = locked.runNow({ lockHeld: true });
    backupContainer.execStream.end('done\n');
    await expect(p).resolves.toBe(0);
    expect(lock.busy).toBe('restore');
  });
  it('remove is refused while an operation holds the lock', async () => {
    const lock = new DataLock();
    const locked = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'), lock);
    lock.acquire('restore');
    await expect(locked.remove('world-20261009-100000.tgz')).rejects.toMatchObject({ statusCode: 409 });
    expect(existsSync(path.join(dir, 'world-20261009-100000.tgz'))).toBe(true);
  });
```

et l'import en tête du fichier : `import { DataLock } from '../data/data-lock.js';`.

Run: `pnpm --filter @mc/backend exec vitest run src/backups/backup-service.test.ts`
Expected: FAIL (constructeur à deux paramètres, `runNow` sans option).

- [ ] **Step 6: BackupService sous verrou**

Dans `packages/backend/src/backups/backup-service.ts` :

- import : `import { DataLock } from '../data/data-lock.js';`
- constructeur : `constructor(private dir: string, private docker: DockerService, private lock: DataLock = new DataLock()) { super(); }`
- ajouter un accesseur : `get dataLock(): DataLock { return this.lock; }`
- dans `remove(name)`, première ligne : `this.lock.assertFree();`
- remplacer le début de `runNow` :

```ts
  /**
   * Lance `backup now` et résout avec le code de sortie (rejette si le conteneur est injoignable).
   * `lockHeld` : l'appelant tient déjà le verrou (sauvegarde de sécurité d'une restauration).
   */
  async runNow(opts: { lockHeld?: boolean } = {}): Promise<number> {
    if (this.running) throw new AppError(409, 'A backup is already running');
    const release = opts.lockHeld ? () => undefined : this.lock.acquire('backup');
    this.running = true;
    try {
```

et dans le `finally` final : `} finally { this.running = false; release(); }`.

Run: `pnpm --filter @mc/backend exec vitest run src/backups src/data`
Expected: PASS.

- [ ] **Step 7: Vérifier et commiter**

Run: `pnpm typecheck`
Expected: aucune erreur.

```bash
git add packages/common/src packages/backend/package.json pnpm-lock.yaml packages/backend/src/data packages/backend/src/backups/backup-service.ts packages/backend/src/backups/backup-service.test.ts
git commit -m "feat(lot2b): verrou global des écritures, types de restauration et de configuration, dépendance tar"
```

---

### Task 2: Filtre d'archive, inspection et extraction

**Files:**
- Create: `packages/backend/src/backups/archive-filter.ts`
- Test: `packages/backend/src/backups/archive-filter.test.ts`

**Interfaces:**
- Consumes: `tar` (`list`, `extract`, `create` dans les tests), `AppError`.
- Produces:
  - `normalizeEntryPath(p: string): string`
  - `validateEntry(entryPath: string, type: string, linkpath?: string): string | null` (raison du refus, `null` si acceptée)
  - `isGzipFile(file: string): Promise<boolean>`
  - `inspectArchive(file: string): Promise<{ entries: number; bytes: number; topLevel: string[] }>` (lève `AppError(400, …)` sur format ou entrée invalide, limites dépassées)
  - `restoreArchive(file: string, dataDir: string, onProgress: (line: string) => void): Promise<void>` (remplace puis extrait)
  - `MAX_ENTRIES = 200_000`, `MAX_BYTES = 20 * 1024 ** 3`

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/backend/src/backups/archive-filter.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import * as tar from 'tar';
import { normalizeEntryPath, validateEntry, isGzipFile, inspectArchive, restoreArchive } from './archive-filter.js';
import { AppError } from '../middleware/error-handler.js';

describe('normalizeEntryPath / validateEntry', () => {
  it.each([
    ['./world/level.dat', 'world/level.dat'],
    ['././world/', 'world'],
    ['world', 'world'],
    ['/abs', '/abs'],
  ])('normalizes %s -> %s', (i, o) => expect(normalizeEntryPath(i)).toBe(o));
  it.each([
    ['./world/level.dat', 'File'],
    ['./world/', 'Directory'],
    ['server.properties', 'OldFile'],
    ['a/b/c', 'ContiguousFile'],
  ])('accepts %s (%s)', (p, t) => expect(validateEntry(p, t)).toBeNull());
  it.each([
    ['', 'File'], ['./', 'Directory'], ['/etc/passwd', 'File'], ['../x', 'File'], ['world/../../etc/passwd', 'File'],
    ['world/..', 'Directory'], ['a\0b', 'File'],
  ])('rejects path %j', (p, t) => expect(validateEntry(p, t)).toMatch(/path/i));
  it.each([['SymbolicLink'], ['Link'], ['CharacterDevice'], ['BlockDevice'], ['FIFO']])('rejects type %s', (t) =>
    expect(validateEntry('world/x', t, 'target')).toMatch(/type/i));
});

describe('archives', () => {
  let root: string; let src: string; let data: string; let file: string;
  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'mc-arch-'));
    src = path.join(root, 'src'); data = path.join(root, 'data'); file = path.join(root, 'world-20261010-100000.tgz');
    mkdirSync(path.join(src, 'world', 'region'), { recursive: true });
    mkdirSync(path.join(src, 'world_nether'), { recursive: true });
    writeFileSync(path.join(src, 'world', 'level.dat'), 'LEVEL-BACKUP');
    writeFileSync(path.join(src, 'world', 'region', 'r.0.0.mca'), 'REGION');
    writeFileSync(path.join(src, 'world_nether', 'level.dat'), 'NETHER');
    writeFileSync(path.join(src, 'server.properties'), 'motd=from-backup\n');
    await tar.create({ gzip: true, cwd: src, file }, ['.']);
    // Etat courant : world a un fichier en plus, un jar et des logs que l'archive ne contient pas.
    mkdirSync(path.join(data, 'world', 'region'), { recursive: true });
    mkdirSync(path.join(data, 'logs'), { recursive: true });
    writeFileSync(path.join(data, 'world', 'level.dat'), 'LEVEL-CURRENT');
    writeFileSync(path.join(data, 'world', 'region', 'r.9.9.mca'), 'NEWER-REGION');
    writeFileSync(path.join(data, 'server.jar'), 'JAR');
    writeFileSync(path.join(data, 'logs', 'latest.log'), 'LOG');
    writeFileSync(path.join(data, 'server.properties'), 'motd=current\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('detects gzip by magic bytes', async () => {
    expect(await isGzipFile(file)).toBe(true);
    const plain = path.join(root, 'plain.tgz'); writeFileSync(plain, 'not gzip at all');
    expect(await isGzipFile(plain)).toBe(false);
  });

  it('inspects the archive: counts, bytes and top-level entries', async () => {
    const info = await inspectArchive(file);
    expect(info.topLevel.sort()).toEqual(['server.properties', 'world', 'world_nether']);
    expect(info.entries).toBeGreaterThanOrEqual(4);
    expect(info.bytes).toBe('LEVEL-BACKUP'.length + 'REGION'.length + 'NETHER'.length + 'motd=from-backup\n'.length);
  });

  it('refuses a non-gzip file with 400', async () => {
    const plain = path.join(root, 'plain.tgz'); writeFileSync(plain, 'not gzip at all');
    await expect(inspectArchive(plain)).rejects.toMatchObject({ statusCode: 400, message: 'Unsupported archive format (gzip only)' });
  });

  it('refuses an archive with a path escaping the data dir, before writing anything', async () => {
    const outside = path.join(root, 'evil.txt'); writeFileSync(outside, 'EVIL');
    const bad = path.join(root, 'bad.tgz');
    await tar.create({ gzip: true, cwd: src, file: bad, preservePaths: true }, ['./world', '../evil.txt']);
    const err = await inspectArchive(bad).catch((e) => e as AppError);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.message).toMatch(/evil\.txt/);
    await expect(restoreArchive(bad, data, () => undefined)).rejects.toMatchObject({ statusCode: 400 });
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('LEVEL-CURRENT');
    expect(existsSync(path.join(data, 'evil.txt'))).toBe(false);
  });

  it('replaces top-level entries and keeps everything the archive does not contain', async () => {
    const lines: string[] = [];
    await restoreArchive(file, data, (l) => lines.push(l));
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('LEVEL-BACKUP');
    expect(readFileSync(path.join(data, 'world', 'region', 'r.0.0.mca'), 'utf8')).toBe('REGION');
    expect(existsSync(path.join(data, 'world', 'region', 'r.9.9.mca'))).toBe(false);
    expect(readFileSync(path.join(data, 'world_nether', 'level.dat'), 'utf8')).toBe('NETHER');
    expect(readFileSync(path.join(data, 'server.properties'), 'utf8')).toBe('motd=from-backup\n');
    expect(readFileSync(path.join(data, 'server.jar'), 'utf8')).toBe('JAR');
    expect(readFileSync(path.join(data, 'logs', 'latest.log'), 'utf8')).toBe('LOG');
    expect(lines.some((l) => l.includes('world'))).toBe(true);
  });

  it('never writes outside the data dir even if the data dir path is relative', async () => {
    const rel = path.relative(process.cwd(), data);
    await restoreArchive(file, rel, () => undefined);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('LEVEL-BACKUP');
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/backups/archive-filter.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémentation**

Créer `packages/backend/src/backups/archive-filter.ts` :

```ts
import { open, rm } from 'fs/promises';
import path from 'path';
import * as tar from 'tar';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export const MAX_ENTRIES = 200_000;
export const MAX_BYTES = 20 * 1024 ** 3;
const ACCEPTED_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);

/** Retire les `./` de tête et le `/` final ; ne touche pas aux chemins absolus (refusés ensuite). */
export function normalizeEntryPath(p: string): string {
  let out = p.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out === '.' ? '' : out;
}

/** Raison du refus, ou null si l'entrée peut être extraite dans /data. */
export function validateEntry(entryPath: string, type: string, linkpath?: string): string | null {
  if (!ACCEPTED_TYPES.has(type)) return `unsupported entry type ${type}${linkpath ? ` -> ${linkpath}` : ''}`;
  const p = normalizeEntryPath(entryPath);
  if (!p) return 'empty path';
  if (p.includes('\0')) return 'path contains NUL';
  if (path.posix.isAbsolute(p) || /^[A-Za-z]:/.test(p)) return `absolute path ${p}`;
  if (p.split('/').some((seg) => seg === '..')) return `path escapes the data dir: ${p}`;
  return null;
}

export async function isGzipFile(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally { await fh.close(); }
}

const topOf = (p: string) => normalizeEntryPath(p).split('/')[0];

/** Parcourt l'archive sans extraire : valide chaque entrée, compte, et liste les entrées de premier niveau. */
export async function inspectArchive(file: string): Promise<{ entries: number; bytes: number; topLevel: string[] }> {
  if (!(await isGzipFile(file))) throw new AppError(400, 'Unsupported archive format (gzip only)');
  let entries = 0; let bytes = 0; let invalid: string | null = null;
  const top = new Set<string>();
  try {
    await tar.list({
      file, strict: true,
      onReadEntry: (entry) => {
        if (invalid) return;
        const reason = validateEntry(entry.path, String(entry.type), entry.linkpath);
        if (reason) { invalid = reason; return; }
        entries++; bytes += Number(entry.size ?? 0);
        if (entries > MAX_ENTRIES) invalid = `more than ${MAX_ENTRIES} entries`;
        else if (bytes > MAX_BYTES) invalid = `more than ${MAX_BYTES} bytes uncompressed`;
        const t = topOf(entry.path); if (t) top.add(t);
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Corrupt or unreadable archive', (err as Error).message);
  }
  if (invalid) throw new AppError(400, `Archive rejected: ${invalid}`);
  return { entries, bytes, topLevel: [...top] };
}

/**
 * Restauration : chaque entrée de premier niveau de l'archive remplace son homologue dans dataDir,
 * puis l'archive est extraite avec le même filtre qu'à l'inspection. Rien n'est écrit hors dataDir.
 */
export async function restoreArchive(file: string, dataDir: string, onProgress: (line: string) => void): Promise<void> {
  const root = path.resolve(dataDir);
  const info = await inspectArchive(file);
  for (const name of info.topLevel) {
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) throw new AppError(400, `Archive rejected: top-level entry ${name}`);
    onProgress(`replace ${name}`);
    await rm(target, { recursive: true, force: true });
  }
  let n = 0;
  await tar.extract({
    file, cwd: root, strict: true, preservePaths: false,
    filter: (p, entry) => validateEntry(p, String(entry.type), entry.linkpath) === null,
    onReadEntry: (entry) => {
      n++;
      const norm = normalizeEntryPath(entry.path);
      if (n % 200 === 0 || !norm.includes('/')) onProgress(`extract ${norm} (${n}/${info.entries})`);
    },
  });
  logger.info({ file, entries: n }, 'archive restored');
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/archive-filter.test.ts`
Expected: PASS.

```bash
git add packages/backend/src/backups/archive-filter.ts packages/backend/src/backups/archive-filter.test.ts
git commit -m "feat(lot2b): filtre, inspection et extraction des archives de restauration"
```

---

### Task 3: RestoreService

**Files:**
- Create: `packages/backend/src/backups/restore-service.ts`
- Test: `packages/backend/src/backups/restore-service.test.ts`

**Interfaces:**
- Consumes: `BackupService` (`resolve`, `list`, `runNow({ lockHeld: true })`, `ensureContainer`, `dataLock`), `DockerService` (`getStatus`, `hasServerContainer`, `stopServer`, `startServer`, événement `'status'`), `inspectArchive`, `restoreArchive` (tâche 2), `DataLock` (tâche 1).
- Produces: `class RestoreService extends EventEmitter` avec `constructor(deps: { dataDir: string; backups: BackupService; docker: DockerService; stopTimeoutMs?: number })`, `status(): RestoreStatus`, `restore(name: string, opts: { startAfter: boolean; confirmNoSafetyBackup: boolean }, audit: (detail: string) => Promise<void>): Promise<void>` (résout après `check`, la suite en arrière-plan). Événements `'progress'` `{ step, line }` et `'done'` `{ ok, message, safetyBackup }`.

- [ ] **Step 1: Test (échec attendu)**

Créer `packages/backend/src/backups/restore-service.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import * as tar from 'tar';
import { RestoreService } from './restore-service.js';
import { BackupService } from './backup-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (pred: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(5); } };

describe('RestoreService', () => {
  let root: string; let data: string; let backups: string; let archive: string;
  let docker: FakeDocker; let mc: FakeContainer; let mcBackup: FakeContainer; let svc: DockerService;
  let backupSvc: BackupService; let lock: DataLock; let events: unknown[]; let audits: string[];

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'mc-restore-'));
    data = path.join(root, 'data'); backups = path.join(root, 'backups');
    mkdirSync(path.join(data, 'world'), { recursive: true }); mkdirSync(backups);
    writeFileSync(path.join(data, 'world', 'level.dat'), 'CURRENT');
    const src = path.join(root, 'src'); mkdirSync(path.join(src, 'world'), { recursive: true });
    writeFileSync(path.join(src, 'world', 'level.dat'), 'BACKUP');
    archive = path.join(backups, 'world-20261010-100000.tgz');
    await tar.create({ gzip: true, cwd: src, file: archive }, ['.']);
    docker = new FakeDocker();
    mc = new FakeContainer(inspectFixture());
    mcBackup = new FakeContainer(inspectFixture(), undefined, new PassThrough(), new PassThrough(), 0);
    docker.containers.set('mc', mc); docker.containers.set('mc-backup', mcBackup);
    svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    lock = new DataLock();
    backupSvc = new BackupService(backups, svc, lock);
    events = []; audits = [];
  });
  afterEach(() => { svc.stop(); rmSync(root, { recursive: true, force: true }); });

  function service(over: { stopTimeoutMs?: number } = {}) {
    const r = new RestoreService({ dataDir: data, backups: backupSvc, docker: svc, stopTimeoutMs: over.stopTimeoutMs ?? 2000 });
    r.on('progress', (e) => events.push({ progress: e }));
    r.on('done', (e) => events.push({ done: e }));
    return r;
  }
  const auditFn = async (d: string) => { audits.push(d); };
  /** Simule un `stop` du conteneur : le fake passe à exited et émet l'événement Docker. */
  function stopSucceeds() {
    mc.stop = async () => { mc.state = inspectFixture({ Status: 'exited', Running: false }); docker.emitEvent({ Action: 'die', name: 'mc' }); };
  }
  function safetyBackupSucceeds() {
    // runNow lit la sortie du conteneur mc-backup ; on la termine tout de suite et on dépose la nouvelle archive.
    mcBackup.exec = async () => {
      writeFileSync(path.join(backups, 'world-20261010-120000.tgz'), 'x');
      const s = new PassThrough(); s.end('Backup done\n');
      return { start: async () => s as never, inspect: async () => ({ ExitCode: 0, Running: false }) };
    };
  }

  it('runs the full happy path: safety backup, stop, replace, extract, start, done', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    expect(r.status()).toMatchObject({ running: true });
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(true);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
    expect(mc.calls).toEqual(['stop:60', 'start']);
    const steps = events.filter((e) => 'progress' in (e as object)).map((e) => (e as { progress: { step: string } }).progress.step);
    expect([...new Set(steps)]).toEqual(['check', 'safety', 'stop', 'replace', 'extract', 'start']);
    expect(audits).toEqual(['world-20261010-100000.tgz', 'exit ok']);
    expect(r.status()).toEqual({ running: false, step: null });
    expect(lock.busy).toBeNull();
  });

  it('does not start the server when startAfter is false', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: false, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(mc.calls).toEqual(['stop:60']);
  });

  it('refuses before 202 when the archive is unknown, not gzip, or the lock is held', async () => {
    const r = service();
    await expect(r.restore('nope.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 404 });
    writeFileSync(path.join(backups, 'plain.tgz'), 'plain');
    await expect(r.restore('plain.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 400 });
    const release = lock.acquire('backup');
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    release();
    expect(audits).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
  });

  it('with the server stopped, requires confirmNoSafetyBackup and then skips the safety step', async () => {
    mc.state = inspectFixture({ Status: 'exited', Running: false });
    await svc.refresh();
    const r = service();
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: false, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    await r.restore('world-20261010-100000.tgz', { startAfter: false, confirmNoSafetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; safetyBackup: string | null } }).done;
    expect(done).toMatchObject({ ok: true, safetyBackup: null });
    expect(mc.calls).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('aborts without touching data when the safety backup fails', async () => {
    stopSucceeds();
    mcBackup.exec = async () => { const s = new PassThrough(); s.end('boom\n'); return { start: async () => s as never, inspect: async () => ({ ExitCode: 2, Running: false }) }; };
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/safety backup/i);
    expect(mc.calls).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(audits).toEqual(['world-20261010-100000.tgz', expect.stringMatching(/^failed: /)]);
    expect(lock.busy).toBeNull();
  });

  it('aborts without touching data when the server does not stop in time', async () => {
    safetyBackupSucceeds();
    mc.stop = async () => { /* le conteneur ne s'arrête jamais */ };
    const r = service({ stopTimeoutMs: 100 });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/did not stop/i);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(mc.calls).toEqual(['stop:60']);
  });

  it('reports a partial state with the safety backup name when extraction fails, and does not restart', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    // L'archive devient illisible après le check : on la tronque juste avant l'extraction.
    const r = service();
    r.on('progress', (e: { step: string }) => { if (e.step === 'replace') writeFileSync(archive, Buffer.from([0x1f, 0x8b, 0x08, 0x00])); });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/partial/i);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(mc.calls).toEqual(['stop:60']);
    expect(existsSync(path.join(data, 'world', 'level.dat'))).toBe(false);
  });

  it('holds the data lock for the whole run so a manual backup gets 409 meanwhile', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await expect(backupSvc.runNow()).rejects.toMatchObject({ statusCode: 409 });
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(lock.busy).toBeNull();
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/backups/restore-service.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 2: Implémentation**

Créer `packages/backend/src/backups/restore-service.ts` :

```ts
import { EventEmitter } from 'events';
import type { RestoreStatus, RestoreStep, ServerStatus } from '@mc/common';
import type { BackupService } from './backup-service.js';
import type { DockerService } from '../docker/docker-service.js';
import { inspectArchive, restoreArchive } from './archive-filter.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export interface RestoreDeps { dataDir: string; backups: BackupService; docker: DockerService; stopTimeoutMs?: number }
export interface RestoreOptions { startAfter: boolean; confirmNoSafetyBackup: boolean }
type AuditFn = (detail: string) => Promise<void>;

class RestoreFailure extends Error { constructor(message: string, public partial = false) { super(message); } }

/**
 * Restauration d'une archive : check (synchrone, avant le 202) puis, en arrière-plan,
 * safety → stop → replace → extract → start → done. Le verrou est tenu du check à la fin.
 */
export class RestoreService extends EventEmitter {
  private step: RestoreStep | null = null;
  private readonly stopTimeoutMs: number;

  constructor(private deps: RestoreDeps) { super(); this.stopTimeoutMs = deps.stopTimeoutMs ?? 90_000; }

  status(): RestoreStatus { return { running: this.step !== null, step: this.step }; }

  private progress(step: RestoreStep, line: string): void { this.step = step; this.emit('progress', { step, line }); }

  async restore(name: string, opts: RestoreOptions, audit: AuditFn): Promise<void> {
    const { backups, docker } = this.deps;
    // check : tout ce qui peut refuser avant le 202, sans rien écrire.
    const file = await backups.resolve(name);
    backups.dataLock.assertFree();
    if (!(await docker.hasServerContainer())) throw new AppError(503, 'Minecraft container not found');
    const canSafety = docker.getStatus() === 'ready' || docker.getStatus() === 'unhealthy';
    if (canSafety) await backups.ensureContainer();
    else if (!opts.confirmNoSafetyBackup) throw new AppError(409, 'Server is stopped: no safety backup possible, confirm to proceed');
    const info = await inspectArchive(file);
    const release = backups.dataLock.acquire('restore');
    this.progress('check', `${name}: ${info.entries} entries, ${info.topLevel.join(', ')}`);
    void this.run(name, file, opts, canSafety, audit).finally(() => { this.step = null; release(); });
  }

  private async run(name: string, file: string, opts: RestoreOptions, canSafety: boolean, audit: AuditFn): Promise<void> {
    let safetyBackup: string | null = null;
    try {
      if (canSafety) safetyBackup = await this.safetyBackup();
      await audit(name);
      await this.stopServer();
      try {
        await restoreArchive(file, this.deps.dataDir, (line) => this.progress(line.startsWith('replace') ? 'replace' : 'extract', line));
      } catch (err) {
        throw new RestoreFailure(`partial restore: ${(err as Error).message}`, true);
      }
      if (opts.startAfter) {
        this.progress('start', 'starting the server');
        await this.deps.docker.startServer().catch((err) => { throw new RestoreFailure(`restored, but the server did not start: ${(err as Error).message}`); });
      }
      await audit('exit ok');
      this.emit('done', { ok: true, message: 'restored', safetyBackup });
    } catch (err) {
      const message = err instanceof RestoreFailure ? err.message : `failed: ${(err as Error).message}`;
      logger.error({ err, name }, 'restore failed');
      await audit(`failed: ${message}`).catch(() => undefined);
      this.emit('done', { ok: false, message, safetyBackup });
    }
  }

  /** `backup now` sous le verrou déjà tenu ; renvoie le nom de la nouvelle archive. */
  private async safetyBackup(): Promise<string> {
    const { backups } = this.deps;
    this.progress('safety', 'running a safety backup');
    const before = new Set((await backups.list()).entries.map((e) => e.name));
    const relay = (line: string) => this.progress('safety', line);
    backups.on('progress', relay);
    let code: number;
    try { code = await backups.runNow({ lockHeld: true }); }
    catch (err) { throw new RestoreFailure(`safety backup failed: ${(err as Error).message}`); }
    finally { backups.off('progress', relay); }
    if (code !== 0) throw new RestoreFailure(`safety backup failed (exit ${code})`);
    const created = (await backups.list()).entries.filter((e) => !before.has(e.name)).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    if (!created[0]) throw new RestoreFailure('safety backup produced no archive');
    return created[0].name;
  }

  private async stopServer(): Promise<void> {
    const { docker } = this.deps;
    if (docker.getStatus() === 'stopped') { this.progress('stop', 'server already stopped'); return; }
    this.progress('stop', 'stopping the server');
    const stopped = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { docker.off('status', onStatus); reject(new RestoreFailure(`server did not stop within ${Math.round(this.stopTimeoutMs / 1000)} s`)); }, this.stopTimeoutMs);
      const onStatus = (s: ServerStatus) => { if (s === 'stopped') { clearTimeout(timer); docker.off('status', onStatus); resolve(); } };
      docker.on('status', onStatus);
    });
    void docker.stopServer().catch((err) => logger.warn({ err }, 'stop request failed'));
    await stopped;
  }
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/backups/restore-service.test.ts`
Expected: PASS (8 tests).

Run: `pnpm typecheck`
Expected: aucune erreur.

```bash
git add packages/backend/src/backups/restore-service.ts packages/backend/src/backups/restore-service.test.ts
git commit -m "feat(lot2b): service de restauration (sauvegarde de sécurité, arrêt, remplacement, redémarrage)"
```

---

### Task 4: Routes de restauration et câblage backend

**Files:**
- Modify: `packages/backend/src/routes/backups.routes.ts`, `packages/backend/src/index.ts`
- Test: `packages/backend/src/routes/backups.routes.test.ts` (ajout)

**Interfaces:**
- Consumes: `RestoreService` via `req.app.locals.restore` (tâche 3), `BackupService.dataLock` (tâche 1), `audit`.
- Produces: `POST /api/backups/:name/restore` (admin, 202), `GET /api/backups/restore/status` (tous) ; `backups.on('progress'|'done')` inchangés ; diffusion `restore.progress` / `restore.done`.

- [ ] **Step 1: Tests (échec attendu)**

Ajouter à `packages/backend/src/routes/backups.routes.test.ts`, dans le `describe('backups routes')` :

```ts
  it('viewer cannot restore but can read the restore status', async () => {
    const app = appWith('viewer');
    app.locals.restore = { status: () => ({ running: false, step: null }), restore: vi.fn() };
    expect((await request(app).post('/api/backups/w.tgz/restore').send({})).status).toBe(403);
    const st = await request(app).get('/api/backups/restore/status');
    expect(st.status).toBe(200);
    expect(st.body).toEqual({ running: false, step: null });
  });
  it('admin restore: defaults, 202, and the audit callback is wired to backup.restore', async () => {
    const app = appWith('admin');
    const restore = vi.fn(async (_n: string, _o: unknown, auditFn: (d: string) => Promise<void>) => { await auditFn('w.tgz'); });
    app.locals.restore = { status: () => ({ running: true, step: 'check' }), restore };
    const res = await request(app).post('/api/backups/w.tgz/restore').send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(restore).toHaveBeenCalledWith('w.tgz', { startAfter: true, confirmNoSafetyBackup: false }, expect.any(Function));
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.restore', detail: 'w.tgz' }) }));
  });
  it('admin restore forwards the options and surfaces the service error status', async () => {
    const app = appWith('admin');
    const restore = vi.fn().mockRejectedValue(new AppError(409, 'Server is stopped: no safety backup possible, confirm to proceed'));
    app.locals.restore = { status: () => ({ running: false, step: null }), restore };
    const res = await request(app).post('/api/backups/w.tgz/restore').send({ startAfter: false, confirmNoSafetyBackup: false });
    expect(res.status).toBe(409);
    expect(restore).toHaveBeenCalledWith('w.tgz', { startAfter: false, confirmNoSafetyBackup: false }, expect.any(Function));
    expect((await request(app).post('/api/backups/w.tgz/restore').send({ startAfter: 'yes' })).status).toBe(400);
  });
  it('run and delete answer 409 while the data lock is held by a restore', async () => {
    const app = appWith('admin');
    const release = (app.locals.backups as BackupService).dataLock.acquire('restore');
    expect((await request(app).post('/api/backups/run')).status).toBe(409);
    expect((await request(app).delete('/api/backups/w.tgz')).status).toBe(409);
    release();
  });
```

et l'import `AppError` : `import { errorHandler, AppError } from '../middleware/error-handler.js';` (remplace l'import existant de `errorHandler`).

Run: `pnpm --filter @mc/backend exec vitest run src/routes/backups.routes.test.ts`
Expected: FAIL (routes absentes).

- [ ] **Step 2: Routes**

Dans `packages/backend/src/routes/backups.routes.ts`, ajouter avant `backupsRoutes.post('/:name/link', …)` (l'ordre compte : `/restore/status` doit précéder `/:name/...`) :

```ts
backupsRoutes.get('/restore/status', (req: Request, res: Response) => { res.json(req.app.locals.restore.status()); });

// Restauration : la réponse 202 part après les vérifications (archive, verrou, filet) ; la suite est diffusée en WebSocket.
backupsRoutes.post('/:name/restore', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    const body = req.body ?? {};
    for (const k of ['startAfter', 'confirmNoSafetyBackup'] as const) if (body[k] !== undefined && typeof body[k] !== 'boolean') throw new AppError(400, `${k} must be a boolean`);
    const opts = { startAfter: body.startAfter ?? true, confirmNoSafetyBackup: body.confirmNoSafetyBackup ?? false };
    await req.app.locals.restore.restore(name, opts, (detail: string) => audit(req, 'backup.restore', detail));
    res.status(202).json({ accepted: true });
  } catch (err) { next(err); }
});
```

Dans la route `POST /run`, remplacer la ligne `if (backups.isRunning()) { … }` par :

```ts
    if (backups.isRunning()) { res.status(409).json({ error: 'A backup is already running' }); return; }
    backups.dataLock.assertFree();
```

(la suppression passe déjà par `remove()`, qui appelle `assertFree()` depuis la tâche 1).

- [ ] **Step 3: Câblage**

Dans `packages/backend/src/index.ts` :

- import : `import { RestoreService } from './backups/restore-service.js';`
- après `backups.on('listChanged', …)` :

```ts
  const restore = new RestoreService({ dataDir: config.mc.dataDir, backups, docker });
  app.locals.restore = restore;
  restore.on('progress', (e) => broadcast(wss, { type: 'restore.progress', ...e }));
  restore.on('done', (e) => { broadcast(wss, { type: 'restore.done', ...e }); broadcast(wss, { type: 'backup.list.changed' }); });
```

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/backups.routes.test.ts && pnpm typecheck`
Expected: PASS, aucune erreur.

```bash
git add packages/backend/src/routes/backups.routes.ts packages/backend/src/routes/backups.routes.test.ts packages/backend/src/index.ts
git commit -m "feat(lot2b): routes de restauration et diffusion WebSocket"
```

---

### Task 5: Utilitaires server.properties et table itzg

**Files:**
- Modify: `packages/backend/src/utils/server-properties.ts`
- Create: `packages/backend/src/server-properties/itzg-env.ts`
- Test: `packages/backend/src/utils/server-properties.test.ts` (ajout), `packages/backend/src/server-properties/itzg-env.test.ts`

**Interfaces:**
- Consumes: `parseServerProperties(text)` (lot 1).
- Produces:
  - `escapeValue(v: string): string`, `updateServerProperties(text: string, values: Record<string, string>): string`, `validateRawProperties(text: string): string | null`, `maskRconPassword(text: string): string`, `KEY_RE = /^[a-z0-9._-]+$/`, `MAX_PROPERTIES_BYTES = 64 * 1024`.
  - `ITZG_ENV: Record<string, string>` (clé → variable), `ALWAYS_LOCKED = ['enable-rcon', 'rcon.port', 'rcon.password']`, `lockedKeys(env: string[]): Record<string, string>`.

- [ ] **Step 1: Tests (échec attendu)**

Ajouter à `packages/backend/src/utils/server-properties.test.ts` :

```ts
import { escapeValue, updateServerProperties, validateRawProperties, maskRconPassword, parseServerProperties } from './server-properties.js';

describe('updateServerProperties', () => {
  const text = '#Minecraft server properties\n#Fri Oct 10 10:00:00 UTC 2026\nmotd=A Minecraft Server\nmax-players=20\nrcon.password=secret\nwhite-list=false\n';
  it('replaces values in place, keeps comments, order and unknown lines, appends new keys', () => {
    const out = updateServerProperties(text, { motd: 'Hello=World', 'max-players': '10', 'view-distance': '12' });
    expect(out).toBe('#Minecraft server properties\n#Fri Oct 10 10:00:00 UTC 2026\nmotd=Hello\\=World\nmax-players=10\nrcon.password=secret\nwhite-list=false\nview-distance=12\n');
    expect(parseServerProperties(out)).toMatchObject({ motd: 'Hello=World', 'max-players': '10', 'view-distance': '12', 'rcon.password': 'secret' });
  });
  it('handles colon separators and a file without trailing newline', () => {
    expect(updateServerProperties('a:1\nb=2', { a: '9' })).toBe('a=9\nb=2\n');
  });
  it('round-trips escaped values', () => {
    const v = 'C:\\path #hash !bang \u00e9t\u00e9';
    expect(parseServerProperties(`k=${escapeValue(v)}\n`).k).toBe(v);
  });
});

describe('validateRawProperties', () => {
  it('accepts comments, blank lines and key=value / key:value', () => {
    expect(validateRawProperties('# c\n\nmotd=x\nlevel-name:world\n')).toBeNull();
  });
  it.each([['no separator', 'motd'], ['bad key', 'Motd=x'], ['bad key 2', 'a b=c']])('rejects %s', (_l, t) => {
    expect(validateRawProperties(t)).toMatch(/line 1/);
  });
  it('rejects oversized content', () => {
    expect(validateRawProperties('k=' + 'x'.repeat(70 * 1024))).toMatch(/64 KiB/);
  });
});

describe('maskRconPassword', () => {
  it('masks the value whatever the separator and keeps the rest', () => {
    expect(maskRconPassword('a=1\nrcon.password=s3cr3t\nrcon.port:25575\n')).toBe('a=1\nrcon.password=********\nrcon.port:25575\n');
    expect(maskRconPassword('a=1\n')).toBe('a=1\n');
  });
});
```

Créer `packages/backend/src/server-properties/itzg-env.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { ITZG_ENV, ALWAYS_LOCKED, lockedKeys } from './itzg-env.js';

describe('itzg env table', () => {
  it('maps lowercase property keys to uppercase variables', () => {
    for (const [k, v] of Object.entries(ITZG_ENV)) { expect(k).toMatch(/^[a-z0-9.-]+$/); expect(v).toMatch(/^[A-Z0-9_]+$/); }
    expect(ITZG_ENV['motd']).toBe('MOTD');
    expect(ITZG_ENV['white-list']).toBe('ENABLE_WHITELIST');
    expect(ITZG_ENV['gamemode']).toBe('MODE');
    expect(ITZG_ENV['level-name']).toBe('LEVEL');
  });
  it('locks the keys whose variable is set, plus the RCON keys', () => {
    const locked = lockedKeys(['MOTD=hello', 'MAX_PLAYERS=10', 'TZ=Europe/Paris', 'EULA=TRUE']);
    expect(locked).toEqual({ motd: 'MOTD', 'max-players': 'MAX_PLAYERS', 'enable-rcon': 'rcon', 'rcon.port': 'rcon', 'rcon.password': 'rcon' });
  });
  it('ignores the env when OVERRIDE_SERVER_PROPERTIES=false, keeping only the RCON keys', () => {
    expect(lockedKeys(['MOTD=hello', 'OVERRIDE_SERVER_PROPERTIES=false'])).toEqual(Object.fromEntries(ALWAYS_LOCKED.map((k) => [k, 'rcon'])));
    expect(lockedKeys(['MOTD=hello', 'OVERRIDE_SERVER_PROPERTIES=FALSE'])['motd']).toBeUndefined();
  });
  it('treats an empty variable as unset', () => {
    expect(lockedKeys(['MOTD='])['motd']).toBeUndefined();
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/utils/server-properties.test.ts src/server-properties`
Expected: FAIL (exports absents).

- [ ] **Step 2: Utilitaires**

Ajouter à la fin de `packages/backend/src/utils/server-properties.ts` :

```ts
export const KEY_RE = /^[a-z0-9._-]+$/;
export const MAX_PROPERTIES_BYTES = 64 * 1024;
const LINE_RE = /^([^=:\s]+)\s*[=:]\s*(.*)$/;

/** Échappement Java Properties pour une valeur : backslash, séparateurs et marqueurs de commentaire. */
export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/:/g, '\\:').replace(/#/g, '\\#').replace(/!/g, '\\!').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

/**
 * Met à jour des clés dans le texte existant : les lignes connues sont réécrites en place (clé=valeur),
 * commentaires, ordre et lignes inconnues conservés, clés absentes ajoutées à la fin. Sortie en LF avec LF final.
 */
export function updateServerProperties(text: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return line;
    const m = LINE_RE.exec(trimmed);
    if (!m) return line;
    const key = unescapeValue(m[1]);
    if (!pending.has(key)) return line;
    const v = pending.get(key)!; pending.delete(key);
    return `${key}=${escapeValue(v)}`;
  });
  for (const [k, v] of pending) out.push(`${k}=${escapeValue(v)}`);
  return out.join('\n') + '\n';
}

/** Validation du mode brut : commentaires, lignes vides ou `clé=valeur` / `clé:valeur` avec une clé valide. */
export function validateRawProperties(text: string): string | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_PROPERTIES_BYTES) return 'Content exceeds 64 KiB';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    const m = LINE_RE.exec(t);
    if (!m || !KEY_RE.test(m[1])) return `Invalid line ${i + 1}: expected key=value with a lowercase key`;
  }
  return null;
}

export function maskRconPassword(text: string): string {
  return text.replace(/^(\s*rcon\.password\s*[=:]\s*).*$/m, '$1********');
}
```

(`unescapeValue` existe déjà dans ce fichier, en fonction privée : l'utiliser telle quelle.)

Créer `packages/backend/src/server-properties/itzg-env.ts` :

```ts
/** Clés de server.properties réécrites par l'image itzg à chaque démarrage quand la variable est définie. */
export const ITZG_ENV: Record<string, string> = {
  motd: 'MOTD', difficulty: 'DIFFICULTY', 'max-players': 'MAX_PLAYERS', 'view-distance': 'VIEW_DISTANCE',
  'simulation-distance': 'SIMULATION_DISTANCE', 'white-list': 'ENABLE_WHITELIST', 'enforce-whitelist': 'ENFORCE_WHITELIST',
  'online-mode': 'ONLINE_MODE', pvp: 'PVP', gamemode: 'MODE', 'force-gamemode': 'FORCE_GAMEMODE', hardcore: 'HARDCORE',
  'level-name': 'LEVEL', 'level-seed': 'SEED', 'level-type': 'LEVEL_TYPE', 'spawn-protection': 'SPAWN_PROTECTION',
  'allow-flight': 'ALLOW_FLIGHT', 'allow-nether': 'ALLOW_NETHER', 'enable-command-block': 'ENABLE_COMMAND_BLOCK',
  'spawn-monsters': 'SPAWN_MONSTERS', 'spawn-animals': 'SPAWN_ANIMALS', 'spawn-npcs': 'SPAWN_NPCS',
  'generate-structures': 'GENERATE_STRUCTURES', 'max-world-size': 'MAX_WORLD_SIZE', 'max-tick-time': 'MAX_TICK_TIME',
  'server-port': 'SERVER_PORT', 'player-idle-timeout': 'PLAYER_IDLE_TIMEOUT', 'op-permission-level': 'OP_PERMISSION_LEVEL',
  'resource-pack': 'RESOURCE_PACK', 'resource-pack-sha1': 'RESOURCE_PACK_SHA1', 'enable-query': 'ENABLE_QUERY',
  'enable-status': 'ENABLE_STATUS', 'hide-online-players': 'HIDE_ONLINE_PLAYERS',
  'entity-broadcast-range-percentage': 'ENTITY_BROADCAST_RANGE_PERCENTAGE',
  'network-compression-threshold': 'NETWORK_COMPRESSION_THRESHOLD', 'sync-chunk-writes': 'SYNC_CHUNK_WRITES',
};

/** Toujours en lecture seule : les changer couperait MC Manager du serveur. */
export const ALWAYS_LOCKED = ['enable-rcon', 'rcon.port', 'rcon.password'] as const;

/** clé → variable qui la gouverne ('rcon' pour les clés RCON), d'après Config.Env du conteneur Minecraft. */
export function lockedKeys(env: string[]): Record<string, string> {
  const vars = new Map<string, string>();
  for (const e of env) { const i = e.indexOf('='); if (i > 0) vars.set(e.slice(0, i), e.slice(i + 1)); }
  const locked: Record<string, string> = {};
  const override = (vars.get('OVERRIDE_SERVER_PROPERTIES') ?? 'true').toLowerCase() !== 'false';
  if (override) for (const [key, v] of Object.entries(ITZG_ENV)) if (vars.get(v)) locked[key] = v;
  for (const k of ALWAYS_LOCKED) locked[k] = 'rcon';
  return locked;
}
```

- [ ] **Step 3: Vérifier et commiter**

Run: `pnpm --filter @mc/backend exec vitest run src/utils/server-properties.test.ts src/server-properties`
Expected: PASS.

```bash
git add packages/backend/src/utils/server-properties.ts packages/backend/src/utils/server-properties.test.ts packages/backend/src/server-properties
git commit -m "feat(lot2b): mise à jour, validation et masquage de server.properties, table des variables itzg"
```

---

### Task 6: PropertiesService, routes et environnement du conteneur

**Files:**
- Modify: `packages/backend/src/docker/docker-like.ts`, `packages/backend/src/docker/docker-service.ts`, `packages/backend/src/docker/fake-docker.ts`
- Create: `packages/backend/src/server-properties/properties-service.ts`, `packages/backend/src/routes/properties.routes.ts`
- Modify: `packages/backend/src/app.ts`, `packages/backend/src/index.ts`
- Test: `packages/backend/src/server-properties/properties-service.test.ts`, `packages/backend/src/routes/properties.routes.test.ts`

**Interfaces:**
- Consumes: tâche 5, `DataLock` (via `backups.dataLock`), `DockerService.inspectServer()`.
- Produces:
  - `ContainerInspect.Config.Env?: string[]` ; `inspectServer()` renvoie en plus `env: string[]` ; `inspectFixture({ Env })`.
  - `class PropertiesService { constructor(deps: { dataDir: string; docker: DockerService; lock: DataLock }); read(): Promise<ServerPropertiesView>; write(update: ServerPropertiesUpdate): Promise<{ changed: string[]; view: ServerPropertiesView }> }`
  - routeur `propertiesRoutes` monté sur `/api/server/properties` (admin) : `GET`, `PUT`.

- [ ] **Step 1: Env dans l'inspection**

Dans `packages/backend/src/docker/docker-like.ts`, `ContainerInspect.Config` devient : `Config: { Tty: boolean; Image: string; Labels?: Record<string, string>; Env?: string[] };`.

Dans `packages/backend/src/docker/docker-service.ts`, `inspectServer()` renvoie aussi `env: i.Config.Env ?? []` (type de retour étendu avec `env: string[]`).

Dans `packages/backend/src/docker/fake-docker.ts`, `inspectFixture` accepte `Env` : signature `(over: Partial<ContainerInspect['State']> & { Tty?: boolean; Env?: string[] } = {})`, destructuration `const { Tty = false, Env = [], ...state } = over;`, et `Config: { Tty, Image: 'itzg/minecraft-server:latest', Env }`.

Run: `pnpm typecheck && pnpm --filter @mc/backend exec vitest run src/docker`
Expected: aucune erreur, tests existants verts.

- [ ] **Step 2: Test du service (échec attendu)**

Créer `packages/backend/src/server-properties/properties-service.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PropertiesService } from './properties-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

describe('PropertiesService', () => {
  let dir: string; let docker: FakeDocker; let svc: DockerService; let lock: DataLock;
  const text = '#header\nmotd=Hello\nmax-players=20\nrcon.password=secret\nenable-rcon=true\n';
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-props-'));
    writeFileSync(path.join(dir, 'server.properties'), text);
    docker = new FakeDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture({ Env: ['MOTD=Hello', 'EULA=TRUE'] })));
    svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    lock = new DataLock();
  });
  afterEach(() => { svc.stop(); rmSync(dir, { recursive: true, force: true }); });
  const service = () => new PropertiesService({ dataDir: dir, docker: svc, lock });

  it('reads the file with the RCON password masked and env-locked keys', async () => {
    const v = await service().read();
    expect(v.exists).toBe(true);
    expect(v.raw).toContain('rcon.password=********');
    expect(v.raw).not.toContain('secret');
    expect(v.values['rcon.password']).toBe('********');
    expect(v.values.motd).toBe('Hello');
    expect(v.locked).toEqual({ motd: 'MOTD', 'enable-rcon': 'rcon', 'rcon.port': 'rcon', 'rcon.password': 'rcon' });
    expect(v.restartRequired).toBe(false);
  });
  it('reports a missing file without throwing', async () => {
    rmSync(path.join(dir, 'server.properties'));
    const v = await service().read();
    expect(v).toMatchObject({ exists: false, raw: '', values: {} });
  });
  it('writes values atomically, keeps the password, audits the changed keys and flags a restart', async () => {
    const { changed, view } = await service().write({ values: { 'max-players': '10', 'view-distance': '8', 'rcon.password': '********' } });
    expect(changed).toEqual(['max-players', 'view-distance']);
    const file = readFileSync(path.join(dir, 'server.properties'), 'utf8');
    expect(file).toContain('max-players=10');
    expect(file).toContain('rcon.password=secret');
    expect(readdirSync(dir).filter((f) => f.startsWith('.server.properties'))).toEqual([]);
    expect(view.restartRequired).toBe(true);
  });
  it('refuses a locked key with a different value (409) and accepts it unchanged', async () => {
    await expect(service().write({ values: { motd: 'Other' } })).rejects.toMatchObject({ statusCode: 409, message: 'Key motd is managed by MOTD' });
    await expect(service().write({ values: { 'rcon.port': '1' } })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service().write({ values: { motd: 'Hello', 'max-players': '5' } })).resolves.toMatchObject({ changed: ['max-players'] });
  });
  it('validates keys and values', async () => {
    await expect(service().write({ values: { 'Bad Key': 'x' } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service().write({ values: { motd2: 'a\nb' } })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('raw mode replaces the file, keeps the masked password as the real one, and refuses locked changes', async () => {
    await service().write({ raw: '# new\nmotd=Hello\nmax-players=3\nrcon.password=********\nenable-rcon=true\n' });
    const file = readFileSync(path.join(dir, 'server.properties'), 'utf8');
    expect(file).toBe('# new\nmotd=Hello\nmax-players=3\nrcon.password=secret\nenable-rcon=true\n');
    await expect(service().write({ raw: 'motd=Changed\n' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service().write({ raw: 'MOTD=x\n' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('is refused while the data lock is held', async () => {
    const release = lock.acquire('restore');
    await expect(service().write({ values: { 'max-players': '1' } })).rejects.toMatchObject({ statusCode: 409 });
    release();
  });
  it('restartRequired resets when the server restarts after the write', async () => {
    const s = service();
    await s.write({ values: { 'max-players': '2' } });
    expect((await s.read()).restartRequired).toBe(true);
    docker.containers.set('mc', new FakeContainer(inspectFixture({ StartedAt: new Date(Date.now() + 60_000).toISOString() })));
    expect((await s.read()).restartRequired).toBe(false);
  });
  it('explains an EACCES with the path and the chown command', async () => {
    if (process.platform === 'win32') return; // chmod n'empêche pas l'écriture sous Windows
    chmodSync(dir, 0o500);
    const err = await service().write({ values: { 'max-players': '1' } }).catch((e) => e);
    chmodSync(dir, 0o700);
    expect(err.statusCode).toBe(500);
    expect(err.message).toMatch(/chown -R 1000:1000/);
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/server-properties/properties-service.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Service**

Créer `packages/backend/src/server-properties/properties-service.ts` :

```ts
import { readFile, writeFile, rename, rm } from 'fs/promises';
import path from 'path';
import type { ServerPropertiesUpdate, ServerPropertiesView } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { parseServerProperties, updateServerProperties, validateRawProperties, maskRconPassword, escapeValue, KEY_RE, MAX_PROPERTIES_BYTES } from '../utils/server-properties.js';
import { lockedKeys } from './itzg-env.js';
import { logger } from '../utils/logger.js';

const MASK = '********';

export class PropertiesService {
  private lastWriteAt: Date | null = null;
  private readonly file: string;

  constructor(private deps: { dataDir: string; docker: DockerService; lock: DataLock }) { this.file = path.join(deps.dataDir, 'server.properties'); }

  private async readRaw(): Promise<string | null> {
    try { return await readFile(this.file, 'utf8'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
  }

  private async locked(): Promise<Record<string, string>> {
    const i = await this.deps.docker.inspectServer().catch(() => null);
    return lockedKeys(i?.env ?? []);
  }

  private async restartRequired(): Promise<boolean> {
    if (!this.lastWriteAt) return false;
    const i = await this.deps.docker.inspectServer().catch(() => null);
    if (!i?.startedAt) return true;
    return new Date(i.startedAt).getTime() < this.lastWriteAt.getTime();
  }

  private async view(raw: string | null, locked: Record<string, string>): Promise<ServerPropertiesView> {
    const masked = raw === null ? '' : maskRconPassword(raw);
    const values = raw === null ? {} : parseServerProperties(raw);
    if ('rcon.password' in values) values['rcon.password'] = MASK;
    return { raw: masked, values, locked, exists: raw !== null, restartRequired: await this.restartRequired() };
  }

  async read(): Promise<ServerPropertiesView> { return this.view(await this.readRaw(), await this.locked()); }

  /** Écrit sous verrou, de façon atomique ; renvoie les clés changées et la nouvelle vue. */
  async write(update: ServerPropertiesUpdate): Promise<{ changed: string[]; view: ServerPropertiesView }> {
    const release = this.deps.lock.acquire('properties');
    try {
      const current = (await this.readRaw()) ?? '';
      const currentValues = parseServerProperties(current);
      const locked = await this.locked();
      let next: string;
      let changed: string[];
      if ('raw' in update) {
        if (typeof update.raw !== 'string') throw new AppError(400, 'raw must be a string');
        const err = validateRawProperties(update.raw);
        if (err) throw new AppError(400, err);
        // Le mot de passe masqué dans le brut est remplacé par la valeur réelle.
        const real = currentValues['rcon.password'];
        next = real !== undefined ? update.raw.replace(/^(\s*rcon\.password\s*[=:]\s*)\*{8}$/m, `$1${escapeValue(real)}`) : update.raw;
        if (!next.endsWith('\n')) next += '\n';
        const nextValues = parseServerProperties(next);
        for (const [k, v] of Object.entries(nextValues)) if (locked[k] && v !== (currentValues[k] ?? '')) throw new AppError(409, `Key ${k} is managed by ${locked[k]}`);
        for (const k of Object.keys(currentValues)) if (locked[k] && !(k in nextValues)) throw new AppError(409, `Key ${k} is managed by ${locked[k]}`);
        changed = [...new Set([...Object.keys(currentValues), ...Object.keys(nextValues)])].filter((k) => currentValues[k] !== nextValues[k]).sort();
      } else {
        if (!update.values || typeof update.values !== 'object') throw new AppError(400, 'values must be an object');
        const values: Record<string, string> = {};
        for (const [k, v] of Object.entries(update.values)) {
          if (!KEY_RE.test(k)) throw new AppError(400, `Invalid key ${k}`);
          if (typeof v !== 'string' || /[\r\n]/.test(v)) throw new AppError(400, `Invalid value for ${k}`);
          if (k === 'rcon.password' && v === MASK) continue;
          if (locked[k]) { if (v !== (currentValues[k] ?? '')) throw new AppError(409, `Key ${k} is managed by ${locked[k]}`); continue; }
          if (currentValues[k] !== v) values[k] = v;
        }
        changed = Object.keys(values).sort();
        next = changed.length ? updateServerProperties(current, values) : current;
        if (Buffer.byteLength(next, 'utf8') > MAX_PROPERTIES_BYTES) throw new AppError(400, 'Content exceeds 64 KiB');
      }
      if (changed.length) {
        await this.atomicWrite(next);
        this.lastWriteAt = new Date();
      }
      return { changed, view: await this.view(next, locked) };
    } finally { release(); }
  }

  private async atomicWrite(content: string): Promise<void> {
    const tmp = path.join(this.deps.dataDir, `.server.properties.${process.pid}.tmp`);
    try {
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, this.file);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        logger.warn({ err, file: this.file }, 'cannot write server.properties');
        throw new AppError(500, `Cannot write ${this.file}: the data directory is not writable by the backend (UID 1000). Run chown -R 1000:1000 ${this.deps.dataDir} on the host.`);
      }
      throw err;
    }
  }
}
```

Run: `pnpm --filter @mc/backend exec vitest run src/server-properties/properties-service.test.ts`
Expected: PASS (le test EACCES est ignoré sous Windows).

- [ ] **Step 4: Test des routes (échec attendu)**

Créer `packages/backend/src/routes/properties.routes.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { propertiesRoutes } from './properties.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  const view = { raw: 'motd=x\n', values: { motd: 'x' }, locked: {}, exists: true, restartRequired: false };
  app.locals.properties = { read: vi.fn().mockResolvedValue(view), write: vi.fn().mockResolvedValue({ changed: ['motd'], view: { ...view, restartRequired: true } }) };
  app.use('/api/server/properties', propertiesRoutes);
  app.use(errorHandler);
  return app;
}

describe('properties routes', () => {
  it('viewer is refused on GET and PUT', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/server/properties')).status).toBe(403);
    expect((await request(app).put('/api/server/properties').send({ values: { motd: 'y' } })).status).toBe(403);
    expect(app.locals.properties.write).not.toHaveBeenCalled();
  });
  it('admin reads the view', async () => {
    const res = await request(appWith('admin')).get('/api/server/properties');
    expect(res.status).toBe(200);
    expect(res.body.values.motd).toBe('x');
  });
  it('admin writes values, audited with the changed keys, and gets the new view', async () => {
    const app = appWith('admin');
    const res = await request(app).put('/api/server/properties').send({ values: { motd: 'y' } });
    expect(res.status).toBe(200);
    expect(res.body.restartRequired).toBe(true);
    expect(app.locals.properties.write).toHaveBeenCalledWith({ values: { motd: 'y' } });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'server.properties', detail: 'motd' }) }));
  });
  it('raw mode is audited with the line count', async () => {
    const app = appWith('admin');
    await request(app).put('/api/server/properties').send({ raw: 'a=1\nb=2\n' });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'server.properties', detail: 'raw (2 lines)' }) }));
  });
  it('rejects a body with neither values nor raw, and surfaces service errors', async () => {
    const app = appWith('admin');
    expect((await request(app).put('/api/server/properties').send({})).status).toBe(400);
    app.locals.properties.write.mockRejectedValue(new AppError(409, 'Key motd is managed by MOTD'));
    const res = await request(app).put('/api/server/properties').send({ values: { motd: 'y' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Key motd is managed by MOTD');
  });
});
```

Run: `pnpm --filter @mc/backend exec vitest run src/routes/properties.routes.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 5: Routes et câblage**

Créer `packages/backend/src/routes/properties.routes.ts` :

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';

export const propertiesRoutes: Router = Router();
propertiesRoutes.use(requireRole('admin'));

propertiesRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.properties.read()); } catch (err) { next(err); }
});

propertiesRoutes.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const update = typeof body.raw === 'string' ? { raw: body.raw } : body.values && typeof body.values === 'object' ? { values: body.values } : null;
    if (!update) throw new AppError(400, 'Body must contain values or raw');
    // Audit avant l'écriture ; le détail nomme les clés (ou le nombre de lignes en mode brut).
    const detail = 'raw' in update ? `raw (${update.raw.split(/\r?\n/).filter((l: string) => l.trim()).length} lines)` : Object.keys(update.values).sort().join(',');
    await audit(req, 'server.properties', detail);
    const { view } = await req.app.locals.properties.write(update);
    res.json(view);
  } catch (err) { next(err); }
});
```

Dans `packages/backend/src/app.ts` : import `import { propertiesRoutes } from './routes/properties.routes.js';` et, **avant** `app.use('/api/server', serverRoutes);`, ajouter `app.use('/api/server/properties', propertiesRoutes);`.

Dans `packages/backend/src/index.ts` : import `import { PropertiesService } from './server-properties/properties-service.js';` et, après le bloc `restore`, `app.locals.properties = new PropertiesService({ dataDir: config.mc.dataDir, docker, lock: backups.dataLock });`.

- [ ] **Step 6: Vérifier et commiter**

Run: `pnpm typecheck && pnpm --filter @mc/backend run test`
Expected: tout vert.

```bash
git add packages/backend/src
git commit -m "feat(lot2b): lecture et écriture de server.properties, clés verrouillées par l'environnement du conteneur"
```

---

### Task 7: Frontend — restauration depuis la page Sauvegardes

**Files:**
- Modify: `packages/frontend/src/api/backups.api.ts`, `packages/frontend/src/stores/server.store.ts`, `packages/frontend/src/hooks/use-websocket.ts`, `packages/frontend/src/components/backups/BackupTable.tsx`, `packages/frontend/src/components/backups/BackupRunPanel.tsx`, `packages/frontend/src/pages/Backups.tsx`
- Create: `packages/frontend/src/components/backups/RestoreDialog.tsx`
- Modify: `packages/frontend/scripts/i18n-fragments/backups.json`
- Test: `packages/frontend/src/pages/Backups.test.tsx` (ajout), `packages/frontend/src/stores/server.store.test.ts` (ajout)

**Interfaces:**
- Consumes: `RestoreRequest`, `RestoreStatus`, `RestoreStep`, `WsMessage` (`restore.progress`, `restore.done`) de `@mc/common` ; `useServerStore.info.status`.
- Produces: `backupsApi.restore(name, req: RestoreRequest)`, `backupsApi.restoreStatus()` ; store : `restoreOutput: string[]`, `restoreRunning: boolean`, `restoreResult: RestoreResult | null`, `startRestoreOutput()` ; `<RestoreDialog entry open onOpenChange onConfirm loading serverStopped />`.

- [ ] **Step 1: i18n**

Dans `packages/frontend/scripts/i18n-fragments/backups.json`, ajouter aux deux langues (en conservant les clés existantes) :

```json
"restore": "Restore",
"restoring": "Restore in progress…",
"restoreDone": "Restore finished",
"restoreFailed": "Restore failed",
"restoreSafety": "Safety backup: {{name}}",
"restoreThis": "Restore this one",
"confirmRestore": {
  "title": "Restore {{name}}?",
  "description": "A safety backup is taken first, then the server is stopped, the archive content replaces the current data, and the server is started again. Players will be disconnected.",
  "startAfter": "Start the server afterwards",
  "noSafety": "The server is stopped: no safety backup can be taken. The current data will be overwritten without a safety net.",
  "confirmNoSafety": "I understand, restore without a safety backup",
  "confirm": "Restore"
},
"steps": { "check": "check", "safety": "safety backup", "stop": "stopping", "replace": "replacing", "extract": "extracting", "start": "starting" }
```

et en français :

```json
"restore": "Restaurer",
"restoring": "Restauration en cours…",
"restoreDone": "Restauration terminée",
"restoreFailed": "Restauration échouée",
"restoreSafety": "Sauvegarde de sécurité : {{name}}",
"restoreThis": "Restaurer celle-ci",
"confirmRestore": {
  "title": "Restaurer {{name}} ?",
  "description": "Une sauvegarde de sécurité est faite d'abord, puis le serveur est arrêté, le contenu de l'archive remplace les données actuelles, et le serveur redémarre. Les joueurs seront déconnectés.",
  "startAfter": "Redémarrer le serveur ensuite",
  "noSafety": "Le serveur est arrêté : aucune sauvegarde de sécurité n'est possible. Les données actuelles seront écrasées sans filet.",
  "confirmNoSafety": "J'ai compris, restaurer sans sauvegarde de sécurité",
  "confirm": "Restaurer"
},
"steps": { "check": "vérification", "safety": "sauvegarde de sécurité", "stop": "arrêt", "replace": "remplacement", "extract": "extraction", "start": "démarrage" }
```

Puis `node packages/frontend/scripts/merge-i18n.mjs` → `OK`.

- [ ] **Step 2: Tests du store et de la page (échec attendu)**

Ajouter à `packages/frontend/src/stores/server.store.test.ts` :

```ts
describe('restore messages', () => {
  it('accumulates restore progress with the step prefix and ends with the result', () => {
    useServerStore.getState().reset();
    useServerStore.getState().startRestoreOutput();
    useServerStore.getState().apply({ type: 'restore.progress', step: 'safety', line: 'running a safety backup' });
    useServerStore.getState().apply({ type: 'restore.progress', step: 'extract', line: 'extract world (200/400)' });
    expect(useServerStore.getState().restoreRunning).toBe(true);
    expect(useServerStore.getState().restoreOutput).toEqual(['[safety] running a safety backup', '[extract] extract world (200/400)']);
    useServerStore.getState().apply({ type: 'restore.done', ok: false, message: 'partial restore: boom', safetyBackup: 'world-1.tgz' });
    expect(useServerStore.getState().restoreRunning).toBe(false);
    expect(useServerStore.getState().restoreResult).toEqual({ ok: false, message: 'partial restore: boom', safetyBackup: 'world-1.tgz' });
  });
});
```

Ajouter à `packages/frontend/src/pages/Backups.test.tsx` un nouveau `describe` (le mock `backupsApi` du fichier doit gagner `restore: vi.fn()` et `restoreStatus: vi.fn()`) :

```tsx
describe('Backups page restore', () => {
  const entry = { name: 'w.tgz', size: 10, modifiedAt: '2026-10-10T10:00:00Z' };
  beforeEach(() => {
    useServerStore.getState().reset();
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
    vi.mocked(backupsApi.list).mockResolvedValue({ entries: [entry], totalBytes: 10, running: false });
    vi.mocked(backupsApi.restoreStatus).mockResolvedValue({ running: false, step: null });
    vi.mocked(backupsApi.restore).mockResolvedValue({} as never);
  });

  it('admin restores with the default options after confirming', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    setup();
    fireEvent.click(await screen.findByLabelText('restore'));
    expect(await screen.findByText('Restore w.tgz?')).toBeInTheDocument();
    expect(screen.queryByText(/without a safety net/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(backupsApi.restore).toHaveBeenCalledWith('w.tgz', { startAfter: true, confirmNoSafetyBackup: false }));
    expect(useServerStore.getState().restoreRunning).toBe(true);
  });

  it('with the server stopped, requires the explicit no-safety confirmation', async () => {
    useServerStore.setState({ info: { status: 'stopped', containerName: 'mc' } as never });
    setup();
    fireEvent.click(await screen.findByLabelText('restore'));
    expect(await screen.findByText(/without a safety net/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand/));
    fireEvent.click(screen.getByLabelText('Start the server afterwards'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(backupsApi.restore).toHaveBeenCalledWith('w.tgz', { startAfter: false, confirmNoSafetyBackup: true }));
  });

  it('viewer has no restore button; a running restore disables run and restore', async () => {
    useAuthStore.setState({ user: { id: 2, username: 'v', displayName: 'V', role: 'viewer' } });
    setup();
    await screen.findByText('w.tgz');
    expect(screen.queryByLabelText('restore')).not.toBeInTheDocument();
  });

  it('shows the progress panel, then the failure with the safety backup name', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    setup();
    await screen.findByText('w.tgz');
    act(() => { useServerStore.getState().startRestoreOutput(); useServerStore.getState().apply({ type: 'restore.progress', step: 'stop', line: 'stopping the server' }); });
    expect(screen.getByText('Restore in progress…')).toBeInTheDocument();
    expect(screen.getByLabelText('restore')).toBeDisabled();
    act(() => { useServerStore.getState().apply({ type: 'restore.done', ok: false, message: 'partial restore: boom', safetyBackup: 'safe.tgz' }); });
    expect(screen.getByText('Restore failed')).toBeInTheDocument();
    expect(screen.getByText('Safety backup: safe.tgz')).toBeInTheDocument();
  });

  it('surfaces the server error on a refused restore and releases the running state', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    vi.mocked(backupsApi.restore).mockRejectedValue({ response: { status: 409, data: { error: 'Another operation is running: backup' } } });
    setup();
    fireEvent.click(await screen.findByLabelText('restore'));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Another operation is running: backup'));
    expect(useServerStore.getState().restoreRunning).toBe(false);
  });
});
```

(imports à ajouter en tête du fichier de test : `act` depuis `@testing-library/react`.)

Run: `pnpm --filter @mc/frontend exec vitest run src/stores src/pages/Backups.test.tsx`
Expected: FAIL.

- [ ] **Step 3: API et store**

Dans `packages/frontend/src/api/backups.api.ts`, ajouter à l'objet :

```ts
  restore: (name: string, req: RestoreRequest) => api.post(`/backups/${encodeURIComponent(name)}/restore`, req),
  restoreStatus: (): Promise<RestoreStatus> => api.get('/backups/restore/status').then((r) => r.data),
```

et l'import `import type { BackupList, RestoreRequest, RestoreStatus } from '@mc/common';`.

Dans `packages/frontend/src/stores/server.store.ts` :

- import `RestoreResult` depuis `@mc/common` ;
- interface : `restoreOutput: string[]; restoreRunning: boolean; restoreResult: RestoreResult | null; startRestoreOutput: () => void;`
- état initial : `restoreOutput: [], restoreRunning: false, restoreResult: null,`
- `startRestoreOutput: () => set({ restoreOutput: [], restoreRunning: true, restoreResult: null }),`
- `reset` remet aussi ces trois champs ;
- dans `apply` :

```ts
      case 'restore.progress': return { restoreOutput: [...s.restoreOutput, `[${msg.step}] ${msg.line}`], restoreRunning: true };
      case 'restore.done': return { restoreRunning: false, restoreResult: { ok: msg.ok, message: msg.message, safetyBackup: msg.safetyBackup } };
```

Dans `packages/frontend/src/hooks/use-websocket.ts`, la ligne d'invalidation de `backups` devient :

```ts
          if (msg.type === 'backup.list.changed' || msg.type === 'backup.done' || msg.type === 'restore.done') { void queryClient.invalidateQueries({ queryKey: ['backups'] }); void queryClient.invalidateQueries({ queryKey: ['server'] }); }
```

- [ ] **Step 4: Dialogue, table, panneau, page**

Créer `packages/frontend/src/components/backups/RestoreDialog.tsx` :

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupEntry, RestoreRequest } from '@mc/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface Props { entry: BackupEntry | null; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (req: RestoreRequest) => void; loading: boolean; serverStopped: boolean }

/** Confirmation de restauration : options, et double confirmation « sans filet » si le serveur est arrêté. */
export function RestoreDialog({ entry, open, onOpenChange, onConfirm, loading, serverStopped }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && entry && <Body entry={entry} loading={loading} serverStopped={serverStopped} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} lang={i18n.language} t={t} />}</DialogContent>
    </Dialog>
  );
}

function Body({ entry, loading, serverStopped, onCancel, onConfirm, lang, t }: { entry: BackupEntry; loading: boolean; serverStopped: boolean; onCancel: () => void; onConfirm: (r: RestoreRequest) => void; lang: string; t: (k: string, o?: Record<string, unknown>) => string }) {
  const [startAfter, setStartAfter] = useState(true);
  const [noSafety, setNoSafety] = useState(false);
  const canConfirm = !loading && (!serverStopped || noSafety);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('backups.confirmRestore.title', { name: entry.name })}</DialogTitle>
        <DialogDescription>{new Date(entry.modifiedAt).toLocaleString(lang)} — {t('backups.confirmRestore.description')}</DialogDescription>
      </DialogHeader>
      {serverStopped && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">{t('backups.confirmRestore.noSafety')}</p>}
      <div className="space-y-2">
        <div className="flex items-center gap-2"><Checkbox id="restore-start-after" checked={startAfter} onCheckedChange={(v) => setStartAfter(v === true)} /><Label htmlFor="restore-start-after">{t('backups.confirmRestore.startAfter')}</Label></div>
        {serverStopped && <div className="flex items-center gap-2"><Checkbox id="restore-no-safety" checked={noSafety} onCheckedChange={(v) => setNoSafety(v === true)} /><Label htmlFor="restore-no-safety">{t('backups.confirmRestore.confirmNoSafety')}</Label></div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>{t('shared.cancel')}</Button>
        <Button variant="destructive" disabled={!canConfirm} onClick={() => onConfirm({ startAfter, confirmNoSafetyBackup: serverStopped && noSafety })}>{loading ? t('shared.processing') : t('backups.confirmRestore.confirm')}</Button>
      </DialogFooter>
    </>
  );
}
```

Dans `packages/frontend/src/components/backups/BackupTable.tsx` : ajouter la prop `onRestore: (n: string) => void` et `busy: boolean` à la signature, importer `RotateCcw` de lucide, et insérer avant le bouton de téléchargement :

```tsx
              <Button size="icon" variant="ghost" aria-label="restore" disabled={busy} onClick={() => onRestore(e.name)}><RotateCcw className="h-4 w-4" /></Button>
```

Remplacer `packages/frontend/src/components/backups/BackupRunPanel.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { RestoreResult } from '@mc/common';
import { Button } from '@/components/ui/button';

interface Props { lines: string[]; running: boolean; mode?: 'backup' | 'restore'; result?: RestoreResult | null; onRestoreSafety?: (name: string) => void }

/** Sortie en direct d'une sauvegarde manuelle ou d'une restauration, puis le résultat. */
export function BackupRunPanel({ lines, running, mode = 'backup', result = null, onRestoreSafety }: Props) {
  const { t } = useTranslation();
  if (!running && lines.length === 0 && !result) return null;
  const title = running ? t(mode === 'restore' ? 'backups.restoring' : 'backups.running')
    : mode === 'restore' && result ? t(result.ok ? 'backups.restoreDone' : 'backups.restoreFailed') : t('backups.finished');
  return (
    <div className="rounded-md border bg-black/40 p-3 font-mono text-xs">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : result ? (result.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />) : null}
        {title}
      </div>
      {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
      {!running && result && !result.ok && <div className="mt-1 text-red-400">{result.message}</div>}
      {!running && result && result.safetyBackup && (
        <div className="mt-2 flex items-center gap-2">
          <span>{t('backups.restoreSafety', { name: result.safetyBackup })}</span>
          {!result.ok && onRestoreSafety && <Button size="sm" variant="outline" onClick={() => onRestoreSafety(result.safetyBackup!)}>{t('backups.restoreThis')}</Button>}
        </div>
      )}
    </div>
  );
}
```

Remplacer `packages/frontend/src/pages/Backups.tsx` :

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import type { BackupEntry, RestoreRequest } from '@mc/common';
import { backupsApi } from '@/api/backups.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { BackupTable } from '@/components/backups/BackupTable';
import { BackupRunPanel } from '@/components/backups/BackupRunPanel';
import { RestoreDialog } from '@/components/backups/RestoreDialog';
import { formatBytes } from '@/lib/utils';

export default function Backups() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['backups'], queryFn: backupsApi.list });
  const { data: restoreStatus } = useQuery({ queryKey: ['backups', 'restore-status'], queryFn: backupsApi.restoreStatus });
  const { backupOutput, backupRunning, startBackupOutput, restoreOutput, restoreRunning, restoreResult, startRestoreOutput } = useServerStore();
  const status = useServerStore((s) => s.info?.status);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [toRestore, setToRestore] = useState<BackupEntry | null>(null);
  const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('shared.error');

  const run = useMutation({ mutationFn: () => backupsApi.run(), onMutate: startBackupOutput, onError: (e) => {
    // Hors 409 (sauvegarde déjà en cours), aucun backup.done ne viendra : on libère l'état.
    if ((e as { response?: { status?: number } }).response?.status !== 409) useServerStore.setState({ backupRunning: false });
    toast.error(errMsg(e));
  } });
  const del = useMutation({ mutationFn: backupsApi.remove, onSuccess: () => { toast.success(t('backups.deleted')); void qc.invalidateQueries({ queryKey: ['backups'] }); }, onError: (e) => toast.error(errMsg(e)) });
  const restore = useMutation({
    mutationFn: ({ name, req }: { name: string; req: RestoreRequest }) => backupsApi.restore(name, req),
    onMutate: startRestoreOutput,
    onSuccess: () => setToRestore(null),
    onError: (e) => { useServerStore.setState({ restoreRunning: false }); toast.error(errMsg(e)); setToRestore(null); },
  });
  const restoring = restoreRunning || restoreStatus?.running === true;
  const busy = backupRunning || data?.running === true || restoring;
  const serverStopped = status !== 'ready' && status !== 'unhealthy';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('backups.title')}</h1>
        {data && <span className="text-sm text-muted-foreground">{t('backups.total', { count: data.entries.length, size: formatBytes(data.totalBytes) })}</span>}
        {isAdmin && <Button className="ml-auto" size="sm" disabled={busy || run.isPending} onClick={() => run.mutate()}><Archive className="mr-1 h-4 w-4" />{t('backups.runNow')}</Button>}
      </div>
      {(restoring || restoreOutput.length > 0 || restoreResult) ? (
        <BackupRunPanel mode="restore" lines={restoreOutput} running={restoring} result={restoreResult} onRestoreSafety={(n) => { const e = data?.entries.find((x) => x.name === n); if (e) setToRestore(e); }} />
      ) : <BackupRunPanel lines={backupOutput} running={backupRunning || data?.running === true} />}
      <Card><CardContent className="p-4">
        {data && data.entries.length === 0 ? <EmptyState title={t('backups.empty')} /> :
          <BackupTable entries={data?.entries ?? []} isAdmin={isAdmin} busy={busy} onRestore={(n) => { const e = data?.entries.find((x) => x.name === n); if (e) setToRestore(e); }} onDownload={(n) => void backupsApi.download(n).catch((e) => toast.error(errMsg(e)))} onDelete={setToDelete} />}
      </CardContent></Card>
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} title={t('backups.confirmDelete.title')} description={t('backups.confirmDelete.description', { name: toDelete })} destructive loading={del.isPending} onConfirm={() => { if (toDelete) del.mutate(toDelete); setToDelete(null); }} />
      <RestoreDialog entry={toRestore} open={toRestore !== null} onOpenChange={(o) => !o && setToRestore(null)} loading={restore.isPending} serverStopped={serverStopped}
        onConfirm={(req) => { if (toRestore) restore.mutate({ name: toRestore.name, req }); }} />
    </div>
  );
}
```

- [ ] **Step 5: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck && pnpm lint`
Expected: PASS, 0 erreur de lint.

```bash
git add packages/frontend
git commit -m "feat(lot2b): restauration d'un backup depuis la page Sauvegardes"
```

---

### Task 8: Frontend — page Configuration

**Files:**
- Create: `packages/frontend/src/api/config.api.ts`, `packages/frontend/src/pages/Config.tsx`, `packages/frontend/src/components/config/PropertiesForm.tsx`, `packages/frontend/src/components/config/PropertiesRaw.tsx`, `packages/frontend/src/components/config/RestartBanner.tsx`, `packages/frontend/scripts/i18n-fragments/config.json`
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx`, `packages/frontend/src/App.tsx`, `packages/frontend/scripts/i18n-fragments/nav.json`
- Test: `packages/frontend/src/pages/Config.test.tsx`

**Interfaces:**
- Consumes: `ServerPropertiesView`, `ServerPropertiesUpdate` de `@mc/common`, `serverApi.restart()`.
- Produces: `configApi.get()`, `configApi.save(update)` ; route `/config` (admin, redirection des viewers).

- [ ] **Step 1: i18n**

Créer `packages/frontend/scripts/i18n-fragments/config.json` :

```json
{ "namespace": "config", "keys": {
  "en": {
    "title": "Server configuration", "tabs": { "form": "Form", "raw": "Raw file" },
    "missing": "server.properties does not exist yet: start the server once to create it.",
    "lockedBy": "Set by the container variable {{var}}; change it in your compose file.", "lockedRcon": "RCON settings are managed by MC Manager and cannot be edited here.",
    "save": "Save", "saved": "Configuration saved", "noChange": "Nothing to save",
    "restartRequired": "Restart required to apply the saved configuration.", "restartNow": "Restart now", "restartTitle": "Restart the server?", "restartDescription": "Players will be disconnected while the server restarts.", "restarting": "Restart requested",
    "changedLines": "{{count}} changed line(s)",
    "groups": { "general": "General", "world": "World", "players": "Players", "rules": "Rules", "network": "Network" },
    "fields": { "motd": "Message of the day", "difficulty": "Difficulty", "gamemode": "Game mode", "force-gamemode": "Force game mode", "hardcore": "Hardcore", "max-players": "Max players", "view-distance": "View distance", "simulation-distance": "Simulation distance", "spawn-protection": "Spawn protection", "player-idle-timeout": "Idle timeout (min)", "op-permission-level": "Op permission level", "pvp": "PvP", "white-list": "Whitelist", "enforce-whitelist": "Enforce whitelist", "online-mode": "Online mode", "allow-flight": "Allow flight", "allow-nether": "Allow Nether", "enable-command-block": "Command blocks", "spawn-monsters": "Spawn monsters", "spawn-animals": "Spawn animals", "spawn-npcs": "Spawn villagers", "level-name": "World folder", "level-seed": "Seed", "level-type": "World type", "resource-pack": "Resource pack URL", "max-tick-time": "Max tick time (ms)", "server-port": "Server port" }
  },
  "fr": {
    "title": "Configuration du serveur", "tabs": { "form": "Formulaire", "raw": "Fichier brut" },
    "missing": "server.properties n'existe pas encore : démarrez le serveur une fois pour le créer.",
    "lockedBy": "Définie par la variable {{var}} du conteneur ; modifiez-la dans votre fichier compose.", "lockedRcon": "Les réglages RCON sont gérés par MC Manager et ne sont pas modifiables ici.",
    "save": "Enregistrer", "saved": "Configuration enregistrée", "noChange": "Rien à enregistrer",
    "restartRequired": "Redémarrage nécessaire pour appliquer la configuration enregistrée.", "restartNow": "Redémarrer maintenant", "restartTitle": "Redémarrer le serveur ?", "restartDescription": "Les joueurs seront déconnectés pendant le redémarrage.", "restarting": "Redémarrage demandé",
    "changedLines": "{{count}} ligne(s) modifiée(s)",
    "groups": { "general": "Général", "world": "Monde", "players": "Joueurs", "rules": "Règles", "network": "Réseau" },
    "fields": { "motd": "Message du jour", "difficulty": "Difficulté", "gamemode": "Mode de jeu", "force-gamemode": "Forcer le mode de jeu", "hardcore": "Hardcore", "max-players": "Joueurs max", "view-distance": "Distance de vue", "simulation-distance": "Distance de simulation", "spawn-protection": "Protection du spawn", "player-idle-timeout": "Inactivité max (min)", "op-permission-level": "Niveau des opérateurs", "pvp": "PvP", "white-list": "Whitelist", "enforce-whitelist": "Imposer la whitelist", "online-mode": "Mode en ligne", "allow-flight": "Autoriser le vol", "allow-nether": "Autoriser le Nether", "enable-command-block": "Blocs de commande", "spawn-monsters": "Monstres", "spawn-animals": "Animaux", "spawn-npcs": "Villageois", "level-name": "Dossier du monde", "level-seed": "Graine", "level-type": "Type de monde", "resource-pack": "URL du pack de ressources", "max-tick-time": "Temps de tick max (ms)", "server-port": "Port du serveur" }
  }
} }
```

Dans `nav.json`, ajouter `"config": "Configuration"` aux deux langues. Puis `node packages/frontend/scripts/merge-i18n.mjs` → `OK`.

- [ ] **Step 2: Test de la page (échec attendu)**

Créer `packages/frontend/src/pages/Config.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { configApi } from '@/api/config.api';
import Config from './Config';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/config.api', () => ({ configApi: { get: vi.fn(), save: vi.fn() } }));
vi.mock('@/api/server.api', () => ({ serverApi: { restart: vi.fn().mockResolvedValue({}) } }));

const view = { raw: '#c\nmotd=Hello\nmax-players=20\npvp=true\nrcon.password=********\n', values: { motd: 'Hello', 'max-players': '20', pvp: 'true', 'rcon.password': '********' }, locked: { motd: 'MOTD', 'rcon.password': 'rcon', 'rcon.port': 'rcon', 'enable-rcon': 'rcon' }, exists: true, restartRequired: false };

function setup(role: 'admin' | 'viewer' = 'admin', v = view) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(configApi.get).mockResolvedValue(v);
  vi.mocked(configApi.save).mockResolvedValue({ ...v, values: { ...v.values, 'max-players': '10' }, restartRequired: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/config']}><Routes><Route path="/config" element={<Config />} /><Route path="/dashboard" element={<div>DASH</div>} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('Config page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('redirects viewers', async () => {
    setup('viewer');
    expect(await screen.findByText('DASH')).toBeInTheDocument();
    expect(configApi.get).not.toHaveBeenCalled();
  });

  it('renders the form with a locked field and saves only the changed values', async () => {
    setup();
    const motd = await screen.findByLabelText('Message of the day');
    expect(motd).toBeDisabled();
    expect(screen.getByTitle(/container variable MOTD/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Max players'), { target: { value: '10' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(configApi.save).toHaveBeenCalledWith({ values: { 'max-players': '10' } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Configuration saved'));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
  });

  it('raw tab saves the whole text and shows the changed line count', async () => {
    setup();
    await screen.findByLabelText('Message of the day');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Raw file' })); fireEvent.click(screen.getByRole('tab', { name: 'Raw file' }));
    const area = await screen.findByRole('textbox', { name: 'server.properties' });
    fireEvent.change(area, { target: { value: '#c\nmotd=Hello\nmax-players=5\npvp=false\nrcon.password=********\n' } });
    expect(screen.getByText('2 changed line(s)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(configApi.save).toHaveBeenCalledWith({ raw: '#c\nmotd=Hello\nmax-players=5\npvp=false\nrcon.password=********\n' }));
  });

  it('shows the missing-file message read-only', async () => {
    setup('admin', { ...view, exists: false, raw: '', values: {} });
    expect(await screen.findByText(/does not exist yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('surfaces a 409 from the server', async () => {
    setup();
    vi.mocked(configApi.save).mockRejectedValue({ response: { status: 409, data: { error: 'Key motd is managed by MOTD' } } });
    fireEvent.change(await screen.findByLabelText('Max players'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Key motd is managed by MOTD'));
  });
});
```

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Config.test.tsx`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: API, composants, page, navigation**

Créer `packages/frontend/src/api/config.api.ts` :

```ts
import api from './client';
import type { ServerPropertiesUpdate, ServerPropertiesView } from '@mc/common';
export const configApi = {
  get: (): Promise<ServerPropertiesView> => api.get('/server/properties').then((r) => r.data),
  save: (update: ServerPropertiesUpdate): Promise<ServerPropertiesView> => api.put('/server/properties', update).then((r) => r.data),
};
```

Créer `packages/frontend/src/components/config/PropertiesForm.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Field = { key: string; kind: 'text' | 'number' | 'bool' | 'choice'; min?: number; max?: number; options?: string[] };
export const GROUPS: { id: string; fields: Field[] }[] = [
  { id: 'general', fields: [{ key: 'motd', kind: 'text' }, { key: 'difficulty', kind: 'choice', options: ['peaceful', 'easy', 'normal', 'hard'] }, { key: 'gamemode', kind: 'choice', options: ['survival', 'creative', 'adventure', 'spectator'] }, { key: 'force-gamemode', kind: 'bool' }, { key: 'hardcore', kind: 'bool' }] },
  { id: 'players', fields: [{ key: 'max-players', kind: 'number', min: 1, max: 1000 }, { key: 'white-list', kind: 'bool' }, { key: 'enforce-whitelist', kind: 'bool' }, { key: 'online-mode', kind: 'bool' }, { key: 'player-idle-timeout', kind: 'number', min: 0, max: 1440 }, { key: 'op-permission-level', kind: 'number', min: 1, max: 4 }] },
  { id: 'rules', fields: [{ key: 'pvp', kind: 'bool' }, { key: 'allow-flight', kind: 'bool' }, { key: 'enable-command-block', kind: 'bool' }, { key: 'spawn-protection', kind: 'number', min: 0, max: 100 }, { key: 'spawn-monsters', kind: 'bool' }, { key: 'spawn-animals', kind: 'bool' }, { key: 'spawn-npcs', kind: 'bool' }] },
  { id: 'world', fields: [{ key: 'level-name', kind: 'text' }, { key: 'level-seed', kind: 'text' }, { key: 'level-type', kind: 'choice', options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified'] }, { key: 'allow-nether', kind: 'bool' }, { key: 'view-distance', kind: 'number', min: 3, max: 32 }, { key: 'simulation-distance', kind: 'number', min: 3, max: 32 }, { key: 'max-tick-time', kind: 'number', min: -1, max: 600000 }] },
  { id: 'network', fields: [{ key: 'server-port', kind: 'number', min: 1, max: 65535 }, { key: 'resource-pack', kind: 'text' }] },
];

interface Props { values: Record<string, string>; locked: Record<string, string>; draft: Record<string, string>; onChange: (key: string, value: string) => void }

/** Formulaire des clés courantes ; une clé verrouillée est grisée avec la variable qui la gouverne. */
export function PropertiesForm({ values, locked, draft, onChange }: Props) {
  const { t } = useTranslation();
  const current = (k: string) => draft[k] ?? values[k] ?? '';
  const lockTitle = (k: string) => (locked[k] === 'rcon' ? t('config.lockedRcon') : t('config.lockedBy', { var: locked[k] }));
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => (
        <section key={g.id} className="space-y-3">
          <h2 className="text-sm font-medium">{t(`config.groups.${g.id}`)}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {g.fields.map((f) => {
              const id = `prop-${f.key}`; const isLocked = f.key in locked; const label = t(`config.fields.${f.key}`);
              return (
                <div key={f.key} className="flex items-center gap-3" title={isLocked ? lockTitle(f.key) : undefined}>
                  <Label htmlFor={id} className="w-44 shrink-0 text-xs">{label}{isLocked && <Lock className="ml-1 inline h-3 w-3 text-muted-foreground" aria-hidden />}</Label>
                  {f.kind === 'bool' && <Switch id={id} aria-label={label} checked={current(f.key) === 'true'} disabled={isLocked} onCheckedChange={(v) => onChange(f.key, v ? 'true' : 'false')} />}
                  {f.kind === 'number' && <Input id={id} type="number" className="h-8 w-32" min={f.min} max={f.max} value={current(f.key)} disabled={isLocked} onChange={(e) => onChange(f.key, e.target.value)} />}
                  {f.kind === 'text' && <Input id={id} className="h-8" value={current(f.key)} disabled={isLocked} onChange={(e) => onChange(f.key, e.target.value)} />}
                  {f.kind === 'choice' && (
                    <Select value={current(f.key) || undefined} disabled={isLocked} onValueChange={(v) => onChange(f.key, v)}>
                      <SelectTrigger id={id} aria-label={label} className="h-8 w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>{f.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

Créer `packages/frontend/src/components/config/PropertiesRaw.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/components/ui/textarea';

export function changedLineCount(before: string, after: string): number {
  const a = before.split(/\r?\n/); const b = after.split(/\r?\n/);
  const n = Math.max(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i++) if ((a[i] ?? '') !== (b[i] ?? '')) count++;
  return count;
}

export function PropertiesRaw({ original, value, onChange }: { original: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const changed = changedLineCount(original, value);
  return (
    <div className="space-y-2">
      <Textarea aria-label="server.properties" className="min-h-[24rem] font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      <p className="text-xs text-muted-foreground">{t('config.changedLines', { count: changed })}</p>
    </div>
  );
}
```

Créer `packages/frontend/src/components/config/RestartBanner.tsx` :

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { serverApi } from '@/api/server.api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

export function RestartBanner() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const restart = useMutation({ mutationFn: () => serverApi.restart(), onSuccess: () => { toast.success(t('config.restarting')); setOpen(false); }, onError: (e: { response?: { data?: { error?: string } } }) => { toast.error(e.response?.data?.error ?? t('shared.error')); setOpen(false); } });
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <RefreshCw className="h-4 w-4 text-amber-500" />
      <span>{t('config.restartRequired')}</span>
      <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>{t('config.restartNow')}</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t('config.restartTitle')} description={t('config.restartDescription')} destructive loading={restart.isPending} onConfirm={() => restart.mutate()} />
    </div>
  );
}
```

Créer `packages/frontend/src/pages/Config.tsx` :

```tsx
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ServerPropertiesUpdate } from '@mc/common';
import { configApi } from '@/api/config.api';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { PropertiesForm } from '@/components/config/PropertiesForm';
import { PropertiesRaw } from '@/components/config/PropertiesRaw';
import { RestartBanner } from '@/components/config/RestartBanner';

export default function Config() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: configApi.get, enabled: isAdmin });
  const [tab, setTab] = useState<'form' | 'raw'>('form');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (u: ServerPropertiesUpdate) => configApi.save(u),
    onSuccess: (view) => { qc.setQueryData(['config'], view); setDraft({}); setRaw(null); toast.success(t('config.saved')); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? t('shared.error')),
  });
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  if (isLoading || !data) return <PageLoader />;
  const changedValues = Object.fromEntries(Object.entries(draft).filter(([k, v]) => (data.values[k] ?? '') !== v));
  const rawValue = raw ?? data.raw;
  const dirty = tab === 'form' ? Object.keys(changedValues).length > 0 : rawValue !== data.raw;
  const submit = () => {
    if (!dirty) { toast.error(t('config.noChange')); return; }
    save.mutate(tab === 'form' ? { values: changedValues } : { raw: rawValue });
  };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('config.title')}</h1>
        {data.exists && <Button className="ml-auto" size="sm" disabled={!dirty || save.isPending} onClick={submit}>{save.isPending ? t('shared.processing') : t('config.save')}</Button>}
      </div>
      {data.restartRequired && <RestartBanner />}
      {!data.exists ? <EmptyState title={t('config.missing')} /> : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'form' | 'raw')}>
          <TabsList><TabsTrigger value="form">{t('config.tabs.form')}</TabsTrigger><TabsTrigger value="raw">{t('config.tabs.raw')}</TabsTrigger></TabsList>
          <Card className="mt-4"><CardContent className="p-4">
            <TabsContent value="form" className="mt-0"><PropertiesForm values={data.values} locked={data.locked} draft={draft} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} /></TabsContent>
            <TabsContent value="raw" className="mt-0"><PropertiesRaw original={data.raw} value={rawValue} onChange={setRaw} /></TabsContent>
          </CardContent></Card>
        </Tabs>
      )}
    </div>
  );
}
```

Navigation : dans `Sidebar.tsx`, importer `SlidersHorizontal` de lucide et ajouter à la section `nav.server`, après `/players` : `{ to: '/config', icon: SlidersHorizontal, label: 'nav.config', adminOnly: true },`. Dans `App.tsx` : `const Config = lazy(() => import('@/pages/Config'));` et `<Route path="/config" element={<Config />} />` après la route `/journal`.

- [ ] **Step 4: Vérifier et commiter**

Run: `pnpm --filter @mc/frontend run test && pnpm --filter @mc/frontend run typecheck && pnpm lint`
Expected: PASS, 0 erreur de lint.

```bash
git add packages/frontend
git commit -m "feat(lot2b): page Configuration (formulaire et fichier brut de server.properties, redémarrage)"
```

---

### Task 9: Compose, documentation et vérification finale

**Files:**
- Modify: `docker-compose.yml`, `README.md`, `README.fr.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-10-mc-manager-lot2b-donnees-design.md` (statut)

- [ ] **Step 1: Compose**

Dans `docker-compose.yml`, remplacer `- mc-data:/mc/data:ro` par `- mc-data:/mc/data` et ajouter au-dessus le commentaire `# Lecture-écriture depuis le lot 2b : restauration de backup et server.properties (sous verrou, admin, audité).`.

- [ ] **Step 2: README (fr et en)**

Dans les deux README :

1. « Fonctionnalités » : remplacer la puce Backups par une version mentionnant la restauration, et ajouter une puce Configuration :
   - fr : `- Backups : liste, téléchargement, suppression, déclenchement manuel avec sortie en direct, **restauration** (sauvegarde de sécurité, arrêt du serveur, remplacement des données de l'archive, redémarrage, progression en direct)`
   - fr : `- Configuration : éditeur de server.properties (formulaire des clés courantes et fichier brut) ; les clés imposées par les variables du conteneur itzg sont affichées verrouillées ; redémarrage proposé après enregistrement`
   - en : équivalents.
2. Nouvelle section « Restauration » / « Restore » après « Déploiement » : déroulement en six étapes, formats acceptés (gzip seulement), sémantique (les dossiers de l'archive remplacent les actuels, le reste est conservé), cas du serveur arrêté (confirmation sans filet), état partiel (le nom de la sauvegarde de sécurité est affiché), verrou (une opération à la fois).
3. Nouvelle section « Configuration du serveur » / « Server configuration » : clés verrouillées par l'environnement, `OVERRIDE_SERVER_PROPERTIES=false` pour rendre le fichier maître, clés RCON non modifiables, redémarrage.
4. « Volumes et réseau » : le montage de `/mc/data` est en lecture-écriture depuis le lot 2b, et la section « Propriétaire des volumes » couvre aussi `/data` (`chown -R 1000:1000` sur le dossier de données si le backend ne peut pas écrire).
5. « Avertissement sur le socket Docker » : une phrase sur le fait que le backend écrit maintenant dans les données du serveur, d'où l'importance de l'authentification et de la MFA.
6. « Feuille de route » : retirer le lot 2b (livré) ; section « Hors périmètre » inchangée.

- [ ] **Step 3: CLAUDE.md**

- Vue d'ensemble : « Les lots 1, 2a et 2b sont implémentés. »
- Architecture backend, après la puce Joueurs : 

```markdown
- **Restauration (lot 2b)** : `backups/restore-service.ts` enchaîne check → safety (`backups.runNow({ lockHeld: true })`) → stop (attente de `status === 'stopped'`, 90 s) → replace → extract (`backups/archive-filter.ts` : gzip seulement, entrées validées avant toute écriture, dossiers de premier niveau remplacés) → start, en diffusant `restore.progress` / `restore.done`. `data/data-lock.ts` sérialise sauvegarde manuelle, restauration et `server.properties` (409 sinon).
- **server.properties** : `server-properties/properties-service.ts` lit (mot de passe RCON masqué), fusionne (`updateServerProperties`) ou remplace (mode brut validé) et écrit de façon atomique ; les clés gouvernées par `Config.Env` du conteneur (`server-properties/itzg-env.ts`) et les clés RCON sont refusées en 409. Routes `GET/PUT /api/server/properties` (admin, audit `server.properties`).
```

- Invariants de sécurité : remplacer la ligne « Le volume de données Minecraft est monté en lecture seule (`:ro`) » par : « Le volume de données est monté en lecture-écriture depuis le lot 2b ; les seules écritures sont la restauration et `server.properties`, admin, auditées, sous `DataLock`, avec un filtre d'archive strict. Le mot de passe RCON n'est jamais renvoyé ni modifiable. » Mettre à jour la ligne du lot 2a qui dit « Rien n'écrit dans `/data` ».
- Tests : mentionner `archive-filter` (archives réelles dans un dossier temporaire) et `restore-service` (fakes Docker, arrêt simulé par événement).

- [ ] **Step 4: Spec**

Statut de la spec 2b : `**Statut :** validé et implémenté (voir le plan 2026-10-10-mc-manager-lot2b-donnees.md)`.

- [ ] **Step 5: Vérification complète**

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm db:generate
pnpm --filter @mc/common run build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config
```

Expected: tout vert ; `docker compose config` affiche le montage `/mc/data` sans `:ro` ; `pnpm audit` sans nouvel avis « high » non ignoré (si `tar` en apporte un sans correctif, ne pas modifier la liste d'exclusions, le signaler).

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml README.md README.fr.md CLAUDE.md docs/superpowers/specs/2026-10-10-mc-manager-lot2b-donnees-design.md
git commit -m "docs(lot2b): compose en écriture, README, CLAUDE.md et statut de la spec"
```
