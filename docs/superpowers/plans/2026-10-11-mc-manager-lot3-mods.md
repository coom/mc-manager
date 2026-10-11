# Lot 3 : gestion des mods depuis la WebUI, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une page « Mods » qui liste les mods du serveur (Modrinth et jars manuels) et permet à un admin de les activer, désactiver, ajouter ou retirer, avec indication « redémarrage requis ».

**Architecture:** Le backend pilote le fichier de liste natif itzg `<dataDir>/mc-manager/modrinth-projects.txt` (désactiver = commenter la ligne) et renomme les jars manuels en `.jar.disabled` dans `mods/`. Le manifeste `.modrinth-manifest.json` écrit par l'image dit ce qui est réellement installé. Un nouveau `ModsService` agrège le tout en `ModsView`, exposé par `/api/mods` ; le frontend ajoute une page `/mods` branchée sur TanStack Query et le message WebSocket `mods.changed`.

**Tech Stack:** Express + Prisma/SQLite, dockerode (via `DockerService` existant), `fetch` natif vers `api.modrinth.com`, vitest + supertest côté backend ; React 18, TanStack Query, shadcn, i18next, Testing Library côté frontend.

**Spec:** `docs/superpowers/specs/2026-10-11-mc-manager-lot3-mods-design.md`

## Global Constraints

- Node 20+ (CI et Docker en 22), pnpm 9. `pnpm db:generate` obligatoire après toute modification de `schema.prisma`, et `pnpm --filter @mc/common run build` après toute modification de `packages/common`.
- Avant chaque commit : `pnpm lint`, `pnpm typecheck`, tests du package touché. Avant de pousser : l'ordre complet de la CI (`db:generate`, build common, lint, typecheck, test, build).
- Aucune modification des variables d'environnement du conteneur Minecraft : le partenaire édite son compose, la WebUI lui donne la ligne `MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"`.
- Seules écritures ajoutées dans `/data` : le fichier `mc-manager/modrinth-projects.txt` et des renommages `.jar` ⇄ `.jar.disabled` à l'intérieur de `mods/` (ou `plugins/`). Jamais de suppression de jar, jamais d'écriture ailleurs. Toute écriture sous `DataLock.acquire('mods')`, admin, auditée, suivie d'un broadcast `mods.changed`.
- Grammaire d'une entrée : `^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$` (préfixe insensible à la casse). Une ligne du fichier qui n'y correspond pas est conservée telle quelle et jamais réécrite.
- Convention de ligne désactivée : `# <entrée>` à l'écriture ; à la lecture, `#`, espaces optionnels puis une entrée valide est reconnu comme désactivé.
- Appels sortants : `api.modrinth.com` depuis le backend uniquement à l'ajout et pour résoudre en arrière-plan les entrées sans métadonnées (au plus une tentative par slug et par heure) ; `cdn.modrinth.com` depuis le navigateur pour les icônes.
- Codes d'erreur renvoyés dans `{ error, code }` : `invalid_entry`, `duplicate`, `unknown_project`, `wrong_type`, `loader_mismatch`, `modrinth_unavailable`, `unsupported_server`, `busy`, `conflict`, `not_found`.
- i18n : jamais d'édition directe de `fr.json`/`en.json` ; fragment dans `packages/frontend/scripts/i18n-fragments/` puis `node packages/frontend/scripts/merge-i18n.mjs`.
- Commits en français, type conventionnel (`feat(lot3): …`, `test(lot3): …`, `docs(lot3): …`), terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- **Slug en majuscules** (`Lithium`) : Modrinth n'a que des slugs minuscules ; un doublon doit être détecté quelle que soit la casse et la ligne écrite doit être exactement ce que l'utilisateur a tapé (test « doublon insensible à la casse » dans la tâche 7).
- **Fichier de liste édité sous Windows** (fins de ligne CRLF) : le parse ne doit pas laisser de `\r` dans les entrées, et la réécriture ne doit pas dupliquer les lignes (test « CRLF » dans la tâche 3).
- **Entrée de route contenant un caractère de chemin** (`/api/mods/modrinth/..%2Fx`) : la grammaire rejette avant toute lecture de fichier, 400 `invalid_entry` (test dans la tâche 8).
- **Les deux formes d'un jar manuel existent** (`x.jar` et `x.jar.disabled`) : aucun renommage ne doit écraser l'autre fichier, 409 `conflict` (tests « conflit » et « cible existante » dans la tâche 7).
- **Conteneur Minecraft introuvable** : `GET /api/mods` doit répondre 200 avec `server: null` et `source: 'none'`, jamais 500 (test dans la tâche 6).

---

### Task 1 : types communs, code d'erreur, verrou `mods`

**Files:**
- Create: `packages/common/src/types/mods.ts`
- Modify: `packages/common/src/index.ts`
- Modify: `packages/common/src/types/audit.ts`
- Modify: `packages/common/src/ws-messages.ts`
- Modify: `packages/backend/src/middleware/error-handler.ts`
- Modify: `packages/backend/src/data/data-lock.ts`
- Modify: `docs/superpowers/specs/2026-10-11-mc-manager-lot3-mods-design.md` (section 2.4, voir étape 6)
- Test: `packages/backend/src/data/data-lock.test.ts`, `packages/backend/src/middleware/error-handler.test.ts` (nouveau)

**Interfaces:**
- Produces: `ModsView`, `ModrinthMod`, `ManualMod`, `ModsSource`, `ModsDir`, `ModsErrorCode`, `WsMessage` `{ type: 'mods.changed' }`, actions d'audit `mods.*`, `AppError(statusCode, message, details?, code?)`, `DataOp` `'mods'`.

- [ ] **Step 1 : écrire les types communs**

`packages/common/src/types/mods.ts` :

```ts
export type ModsSource = 'file' | 'inline' | 'other' | 'none';
export type ModsDir = 'mods' | 'plugins';
export type ModsErrorCode =
  | 'invalid_entry' | 'duplicate' | 'unknown_project' | 'wrong_type' | 'loader_mismatch'
  | 'modrinth_unavailable' | 'unsupported_server' | 'busy' | 'conflict' | 'not_found';

/** Une entrée du fichier de liste Modrinth géré par MC Manager. */
export interface ModrinthMod {
  /** Texte exact de l'entrée (identifiant pour les routes). */
  entry: string;
  /** Partie projet, en minuscules, sans préfixe, version ni `?`. */
  slug: string;
  /** Ligne active (true) ou commentée (false). */
  enabled: boolean;
  /** Présent dans `projects` du manifeste écrit par l'image au dernier démarrage. */
  installed: boolean;
  title: string | null;
  iconUrl: string | null;
  projectId: string | null;
}

/** Un jar du dossier mods/ (ou plugins/) qui n'est pas géré par Modrinth. */
export interface ManualMod {
  /** Nom du fichier sans suffixe `.disabled` (identifiant pour les routes). */
  file: string;
  enabled: boolean;
  size: number;
  mtime: string;
  /** `file` et `file.disabled` existent tous les deux : aucune action possible. */
  conflict: boolean;
}

export interface ModsView {
  /** null : type de serveur non supporté (vanilla, inconnu) ou conteneur introuvable. */
  server: { loader: string; dir: ModsDir } | null;
  source: ModsSource;
  /** Entrées de la variable MODRINTH_PROJECTS quand source = 'inline' (pour l'import). */
  inlineEntries: string[];
  listingExists: boolean;
  /** Ligne à mettre dans le compose : MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt" */
  composeLine: string;
  restartRequired: boolean;
  modrinth: ModrinthMod[];
  /** Lignes du fichier conservées telles quelles : commentaires libres et lignes invalides. */
  unmanagedLines: { raw: string; invalid: boolean }[];
  manual: ManualMod[];
}
```

Dans `packages/common/src/index.ts`, ajouter `export * from './types/mods.js';` après la ligne `properties`.

Dans `packages/common/src/types/audit.ts`, étendre `AuditAction` :

```ts
  | 'journal.retention'
  | 'mods.import' | 'mods.add' | 'mods.toggle' | 'mods.remove' | 'mods.file.toggle';
```

Dans `packages/common/src/ws-messages.ts`, ajouter à la fin de l'union `WsMessage` :

```ts
  | { type: 'mods.changed' };
```

- [ ] **Step 2 : construire common et vérifier le type**

Run: `pnpm --filter @mc/common run build && pnpm --filter @mc/common run typecheck`
Expected: succès, `packages/common/dist/types/mods.d.ts` existe.

- [ ] **Step 3 : écrire le test de `AppError` avec code**

`packages/backend/src/middleware/error-handler.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AppError, errorHandler } from './error-handler.js';

function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  return res as unknown as Response & { statusCode: number; body: { error: string; details?: string; code?: string } };
}

describe('errorHandler', () => {
  it('includes the machine-readable code when the AppError carries one', () => {
    const res = fakeRes();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorHandler(new AppError(409, 'Entry already listed', undefined, 'duplicate'), {} as Request, res, (() => undefined) as NextFunction);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Entry already listed', details: undefined, code: 'duplicate' });
  });
  it('omits code when absent', () => {
    const res = fakeRes();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorHandler(new AppError(400, 'bad'), {} as Request, res, (() => undefined) as NextFunction);
    expect(res.body).toEqual({ error: 'bad', details: undefined });
  });
});
```

- [ ] **Step 4 : lancer le test pour le voir échouer**

Run: `pnpm --filter @mc/backend exec vitest run src/middleware/error-handler.test.ts`
Expected: FAIL (`code` absent de la réponse, et le 4e argument du constructeur n'existe pas).

- [ ] **Step 5 : étendre `AppError` et `errorHandler`**

Dans `packages/backend/src/middleware/error-handler.ts` :

```ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: string,
    /** Code stable pour le frontend (traduit côté client), ex. 'duplicate'. */
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error(`[Error] ${err.name}: ${err.message}`);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
      ...(err.code ? { code: err.code } : {}),
    });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}
```

- [ ] **Step 6 : ajouter `'mods'` à `DataOp` avec le code `busy`**

Dans `packages/backend/src/data/data-lock.ts` :

```ts
export type DataOp = 'backup' | 'restore' | 'properties' | 'mods';
```

et dans `assertFree()` :

```ts
    if (this.current) throw new AppError(409, `Another operation is running: ${this.current}`, undefined, 'busy');
```

Ajouter dans `packages/backend/src/data/data-lock.test.ts` un test :

```ts
  it('refuses a second operation with the busy code', () => {
    const lock = new DataLock();
    lock.acquire('mods');
    try { lock.acquire('restore'); throw new Error('should have thrown'); }
    catch (err) { expect((err as AppError).statusCode).toBe(409); expect((err as AppError).code).toBe('busy'); }
  });
```

(importer `AppError` depuis `../middleware/error-handler.js` si le fichier de test ne l'importe pas déjà.)

Corriger aussi la spec, section 2.4, dernière condition de `restartRequired` : remplacer la phrase sur le `mtime` du dossier par « un renommage manuel a eu lieu depuis le démarrage du conteneur (horodatage de la dernière écriture gardé en mémoire par le service, comparé à `State.StartedAt`, même mécanisme que `PropertiesService`) ; un redémarrage du backend remet ce drapeau à zéro ». Raison : l'image elle-même écrit dans `mods/` après `StartedAt` au moment du téléchargement, un `mtime` serait toujours postérieur.

Préciser aussi la spec, section 3.5, point `add(entry)` : « `projectType` ≠ `mod` → 422 `wrong_type` (l'API Modrinth classe mods, plugins et datapacks sous `project_type: "mod"` et les distingue par `loaders` ; `modpack`, `resourcepack`, `shader` sont refusés) ; le loader attendu est le préfixe de l'entrée s'il y en a un (`datapack:`, `fabric:`, …), sinon celui du serveur ».

- [ ] **Step 7 : lancer les tests, lint et typecheck**

Run: `pnpm --filter @mc/backend exec vitest run src/middleware/error-handler.test.ts src/data/data-lock.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, aucune erreur.

- [ ] **Step 8 : commit**

```bash
git add packages/common/src packages/backend/src/middleware packages/backend/src/data docs/superpowers/specs/2026-10-11-mc-manager-lot3-mods-design.md
git commit -m "feat(lot3): types communs des mods, code d'erreur AppError, verrou mods

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : `server-type.ts`, type de serveur et source Modrinth

**Files:**
- Create: `packages/backend/src/mods/server-type.ts`
- Test: `packages/backend/src/mods/server-type.test.ts`

**Interfaces:**
- Produces: `serverTypeOf(env: string[]): { loader: string; dir: ModsDir } | null`, `modrinthSource(env: string[]): { source: ModsSource; inlineEntries: string[] }`, `envMap(env: string[]): Map<string, string>`, constantes `LISTING_PATH_IN_CONTAINER`, `LISTING_RELATIVE` (`mc-manager/modrinth-projects.txt`), `COMPOSE_LINE`.

- [ ] **Step 1 : écrire les tests**

`packages/backend/src/mods/server-type.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { serverTypeOf, modrinthSource, COMPOSE_LINE } from './server-type.js';

describe('serverTypeOf', () => {
  it('maps mod loaders to mods/ and plugin servers to plugins/', () => {
    expect(serverTypeOf(['TYPE=FABRIC'])).toEqual({ loader: 'fabric', dir: 'mods' });
    expect(serverTypeOf(['TYPE=neoforge'])).toEqual({ loader: 'neoforge', dir: 'mods' });
    expect(serverTypeOf(['TYPE=PAPER'])).toEqual({ loader: 'paper', dir: 'plugins' });
    expect(serverTypeOf(['TYPE=Purpur'])).toEqual({ loader: 'purpur', dir: 'plugins' });
  });
  it('returns null for vanilla, unknown types and a missing variable', () => {
    expect(serverTypeOf(['TYPE=VANILLA'])).toBeNull();
    expect(serverTypeOf(['TYPE=CUSTOM'])).toBeNull();
    expect(serverTypeOf(['EULA=TRUE'])).toBeNull();
    expect(serverTypeOf([])).toBeNull();
  });
});

describe('modrinthSource', () => {
  it('detects the managed listing file', () => {
    expect(modrinthSource(['MODRINTH_PROJECTS=@/data/mc-manager/modrinth-projects.txt'])).toEqual({ source: 'file', inlineEntries: [] });
  });
  it('splits an inline list on commas and newlines, trimming blanks', () => {
    expect(modrinthSource(['MODRINTH_PROJECTS=fabric-api, lithium\nkrypton,,'])).toEqual({ source: 'inline', inlineEntries: ['fabric-api', 'lithium', 'krypton'] });
  });
  it('reports another listing file as other, and an empty or missing variable as none', () => {
    expect(modrinthSource(['MODRINTH_PROJECTS=@/extras/mods.txt'])).toEqual({ source: 'other', inlineEntries: [] });
    expect(modrinthSource(['MODRINTH_PROJECTS='])).toEqual({ source: 'none', inlineEntries: [] });
    expect(modrinthSource([])).toEqual({ source: 'none', inlineEntries: [] });
  });
  it('exposes the compose line', () => {
    expect(COMPOSE_LINE).toBe('MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"');
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/server-type.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémenter**

`packages/backend/src/mods/server-type.ts` :

```ts
import type { ModsDir, ModsSource } from '@mc/common';

/** Chemin du fichier de liste tel que le conteneur Minecraft le voit (son volume est monté sur /data). */
export const LISTING_PATH_IN_CONTAINER = '/data/mc-manager/modrinth-projects.txt';
/** Même fichier, relatif à dataDir côté backend. */
export const LISTING_RELATIVE = 'mc-manager/modrinth-projects.txt';
export const COMPOSE_LINE = `MODRINTH_PROJECTS: "@${LISTING_PATH_IN_CONTAINER}"`;

const MOD_LOADERS: Record<string, string> = { FABRIC: 'fabric', QUILT: 'quilt', FORGE: 'forge', NEOFORGE: 'neoforge' };
const PLUGIN_LOADERS: Record<string, string> = { PAPER: 'paper', SPIGOT: 'spigot', BUKKIT: 'bukkit', PURPUR: 'purpur', FOLIA: 'folia' };

export function envMap(env: string[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const e of env) { const i = e.indexOf('='); if (i > 0) vars.set(e.slice(0, i), e.slice(i + 1)); }
  return vars;
}

/** Loader Modrinth et dossier cible d'après TYPE ; null si vanilla ou type inconnu. */
export function serverTypeOf(env: string[]): { loader: string; dir: ModsDir } | null {
  const type = (envMap(env).get('TYPE') ?? 'VANILLA').trim().toUpperCase();
  if (MOD_LOADERS[type]) return { loader: MOD_LOADERS[type], dir: 'mods' };
  if (PLUGIN_LOADERS[type]) return { loader: PLUGIN_LOADERS[type], dir: 'plugins' };
  return null;
}

/** Origine de la liste Modrinth d'après MODRINTH_PROJECTS du conteneur. */
export function modrinthSource(env: string[]): { source: ModsSource; inlineEntries: string[] } {
  const value = (envMap(env).get('MODRINTH_PROJECTS') ?? '').trim();
  if (!value) return { source: 'none', inlineEntries: [] };
  if (value === `@${LISTING_PATH_IN_CONTAINER}`) return { source: 'file', inlineEntries: [] };
  if (value.startsWith('@')) return { source: 'other', inlineEntries: [] };
  const inlineEntries = value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return { source: 'inline', inlineEntries };
}
```

- [ ] **Step 4 : lancer les tests**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/server-type.test.ts`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/mods/server-type.ts packages/backend/src/mods/server-type.test.ts
git commit -m "feat(lot3): type de serveur et source MODRINTH_PROJECTS lus dans l'environnement du conteneur

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : `listing-file.ts`, parse et écriture du fichier de liste

**Files:**
- Create: `packages/backend/src/mods/listing-file.ts`
- Create: `packages/backend/src/utils/atomic-write.ts`
- Test: `packages/backend/src/mods/listing-file.test.ts`

**Interfaces:**
- Produces: `ENTRY_RE`, `isValidEntry(s: string): boolean`, `slugOf(entry: string): string`, `prefixOf(entry: string): string | null`, `type ListingLine`, `isManaged(l): l is ManagedLine`, `parseListing(text: string): ListingLine[]`, `serializeListing(lines: ListingLine[]): string`, `readListing(file: string): Promise<{ exists: boolean; lines: ListingLine[] }>`, `writeListing(file: string, lines: ListingLine[]): Promise<void>`, `atomicWriteFile(file: string, content: string): Promise<void>`.

- [ ] **Step 1 : écrire les tests**

`packages/backend/src/mods/listing-file.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { isValidEntry, slugOf, prefixOf, parseListing, serializeListing, readListing, writeListing } from './listing-file.js';

describe('entry grammar', () => {
  it('accepts the itzg forms', () => {
    for (const e of ['lithium', 'fabric-api', 'lithium:0.14.0', 'lithium:Oa9ZDzZq', 'c2me-fabric:alpha+', 'pl3xmap?', 'fabric:sodium:beta', 'datapack:terralith', 'PAPER:chunky']) expect(isValidEntry(e), e).toBe(true);
  });
  it('rejects spaces, separators, comments and short names', () => {
    for (const e of ['', 'ab', 'li thium', '../x', 'a/b', '#lithium', 'lithium:0.1 4', 'lithium\n', 'a'.repeat(65)]) expect(isValidEntry(e), JSON.stringify(e)).toBe(false);
  });
  it('extracts the slug in lower case, without prefix, version or ?', () => {
    expect(slugOf('Lithium')).toBe('lithium');
    expect(slugOf('lithium:0.14.0')).toBe('lithium');
    expect(slugOf('fabric:sodium:beta')).toBe('sodium');
    expect(slugOf('pl3xmap?')).toBe('pl3xmap');
    expect(slugOf('paper:chunky')).toBe('chunky');
    expect(prefixOf('fabric:sodium')).toBe('fabric');
    expect(prefixOf('lithium:0.14.0')).toBeNull();
  });
});

describe('parseListing / serializeListing', () => {
  it('classifies lines and keeps the raw text of unmanaged ones', () => {
    const lines = parseListing('# header\n\nfabric-api\n# lithium\n#krypton\n#  spark\nbad entry\n## note\n');
    expect(lines).toEqual([
      { kind: 'comment', raw: '# header' },
      { kind: 'blank', raw: '' },
      { kind: 'entry', entry: 'fabric-api', raw: 'fabric-api' },
      { kind: 'disabled', entry: 'lithium', raw: '# lithium' },
      { kind: 'disabled', entry: 'krypton', raw: '#krypton' },
      { kind: 'disabled', entry: 'spark', raw: '#  spark' },
      { kind: 'invalid', raw: 'bad entry' },
      { kind: 'comment', raw: '## note' },
    ]);
  });
  it('tolerates CRLF and trims surrounding spaces of entries', () => {
    const lines = parseListing('fabric-api\r\n  lithium  \r\n');
    expect(lines).toEqual([{ kind: 'entry', entry: 'fabric-api', raw: 'fabric-api' }, { kind: 'entry', entry: 'lithium', raw: '  lithium  ' }]);
    expect(serializeListing(lines)).toBe('fabric-api\nlithium\n');
  });
  it('serializes disabled lines as "# entry" and unmanaged lines verbatim', () => {
    const text = '# header\nfabric-api\n#krypton\nbad entry\n';
    expect(serializeListing(parseListing(text))).toBe('# header\nfabric-api\n# krypton\nbad entry\n');
    expect(serializeListing([])).toBe('');
  });
});

describe('readListing / writeListing', () => {
  it('reports a missing file and writes atomically, creating the parent folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-listing-'));
    const file = path.join(dir, 'mc-manager', 'modrinth-projects.txt');
    expect(await readListing(file)).toEqual({ exists: false, lines: [] });
    await writeListing(file, [{ kind: 'entry', entry: 'lithium', raw: 'lithium' }, { kind: 'disabled', entry: 'spark', raw: '# spark' }]);
    expect(await readFile(file, 'utf8')).toBe('lithium\n# spark\n');
    expect(await readListing(file)).toEqual({ exists: true, lines: [{ kind: 'entry', entry: 'lithium', raw: 'lithium' }, { kind: 'disabled', entry: 'spark', raw: '# spark' }] });
    await writeFile(file, 'a\r\nb\r\n');
    expect((await readListing(file)).lines.map((l) => l.raw)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/listing-file.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : écrire l'utilitaire d'écriture atomique**

`packages/backend/src/utils/atomic-write.ts` (même mappage d'erreurs que `PropertiesService.atomicWrite`, réutilisable) :

```ts
import { mkdir, writeFile, rename, rm, stat, chmod } from 'fs/promises';
import path from 'path';
import { AppError } from '../middleware/error-handler.js';
import { logger } from './logger.js';

/** Écrit `content` dans `file` via un fichier temporaire puis rename ; crée le dossier parent. */
export async function atomicWriteFile(file: string, content: string): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, content, 'utf8');
    try { await chmod(tmp, (await stat(file)).mode & 0o777); } catch { /* fichier absent ou Windows */ }
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw mapWriteError(err, file, dir);
  }
}

/** Traduit EROFS/ENOSPC/EACCES en AppError 500 explicite ; renvoie l'erreur d'origine sinon. */
export function mapWriteError(err: unknown, file: string, dir: string): unknown {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EROFS') return new AppError(500, `Cannot write ${file}: the data volume is mounted read-only. Remove :ro from the data volume in docker-compose.yml.`);
  if (code === 'ENOSPC') return new AppError(500, `Cannot write ${file}: no space left on the data volume.`);
  if (code === 'EACCES' || code === 'EPERM') {
    logger.warn({ err, file }, 'cannot write in data directory');
    return new AppError(500, `Cannot write ${file}: the data directory is not writable by the backend (UID 1000). Run chown -R 1000:1000 ${dir} on the host.`);
  }
  return err;
}
```

- [ ] **Step 4 : implémenter `listing-file.ts`**

```ts
import { readFile } from 'fs/promises';
import { atomicWriteFile } from '../utils/atomic-write.js';

export const ENTRY_RE = /^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$/i;
const PREFIXES = new Set(['datapack', 'fabric', 'forge', 'paper']);

export const isValidEntry = (s: string): boolean => typeof s === 'string' && ENTRY_RE.test(s);

/** Préfixe de loader de l'entrée (`fabric:sodium` → 'fabric'), null sinon. */
export function prefixOf(entry: string): string | null {
  const parts = entry.replace(/\?$/, '').split(':');
  return parts.length >= 2 && PREFIXES.has(parts[0].toLowerCase()) ? parts[0].toLowerCase() : null;
}

/** Partie projet en minuscules : sans préfixe, sans version, sans `?`. */
export function slugOf(entry: string): string {
  const parts = entry.replace(/\?$/, '').split(':');
  if (parts.length >= 2 && PREFIXES.has(parts[0].toLowerCase())) parts.shift();
  return parts[0].toLowerCase();
}

export type ManagedLine = { kind: 'entry' | 'disabled'; entry: string; raw: string };
export type ListingLine = ManagedLine | { kind: 'comment' | 'blank' | 'invalid'; raw: string };
export const isManaged = (l: ListingLine): l is ManagedLine => l.kind === 'entry' || l.kind === 'disabled';

/** Une ligne par élément ; la dernière ligne vide d'un fichier terminé par un saut de ligne n'est pas comptée. */
export function parseListing(text: string): ListingLine[] {
  const rows = text.split(/\r?\n/);
  if (rows.length && rows[rows.length - 1] === '') rows.pop();
  return rows.map((raw): ListingLine => {
    const t = raw.trim();
    if (t === '') return { kind: 'blank', raw };
    if (t.startsWith('#')) {
      const rest = t.slice(1).trim();
      return isValidEntry(rest) ? { kind: 'disabled', entry: rest, raw } : { kind: 'comment', raw };
    }
    return isValidEntry(t) ? { kind: 'entry', entry: t, raw } : { kind: 'invalid', raw };
  });
}

export function serializeListing(lines: ListingLine[]): string {
  if (!lines.length) return '';
  return lines.map((l) => (l.kind === 'entry' ? l.entry : l.kind === 'disabled' ? `# ${l.entry}` : l.raw)).join('\n') + '\n';
}

export async function readListing(file: string): Promise<{ exists: boolean; lines: ListingLine[] }> {
  try { return { exists: true, lines: parseListing(await readFile(file, 'utf8')) }; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, lines: [] }; throw err; }
}

export async function writeListing(file: string, lines: ListingLine[]): Promise<void> {
  await atomicWriteFile(file, serializeListing(lines));
}
```

- [ ] **Step 5 : lancer les tests, lint, typecheck**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/listing-file.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6 : commit**

```bash
git add packages/backend/src/mods/listing-file.ts packages/backend/src/mods/listing-file.test.ts packages/backend/src/utils/atomic-write.ts
git commit -m "feat(lot3): parse et écriture atomique du fichier de liste Modrinth

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : `manifest.ts`, lecture du manifeste itzg

**Files:**
- Create: `packages/backend/src/mods/manifest.ts`
- Test: `packages/backend/src/mods/manifest.test.ts`

**Interfaces:**
- Produces: `readManifest(dataDir: string): Promise<ModrinthManifest | null>` avec `interface ModrinthManifest { files: string[]; projects: string[] }` (`files` normalisés : séparateurs `/`, sans `./` initial), `MANIFEST_FILE = '.modrinth-manifest.json'`.

- [ ] **Step 1 : écrire les tests**

`packages/backend/src/mods/manifest.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { readManifest, MANIFEST_FILE } from './manifest.js';

describe('readManifest', () => {
  it('returns null when the file is missing or invalid', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-manifest-'));
    expect(await readManifest(dir)).toBeNull();
    await writeFile(path.join(dir, MANIFEST_FILE), '{not json');
    expect(await readManifest(dir)).toBeNull();
    await writeFile(path.join(dir, MANIFEST_FILE), '[1,2]');
    expect(await readManifest(dir)).toBeNull();
  });
  it('reads files and projects, normalizing paths and dropping non-strings', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-manifest-'));
    await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ timestamp: '2026-10-11T00:00:00Z', files: ['mods/lithium-0.14.0.jar', './mods\\spark.jar', 42], projects: ['lithium', 'spark?', null] }));
    expect(await readManifest(dir)).toEqual({ files: ['mods/lithium-0.14.0.jar', 'mods/spark.jar'], projects: ['lithium', 'spark?'] });
  });
  it('defaults missing arrays to empty', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-manifest-'));
    await writeFile(path.join(dir, MANIFEST_FILE), '{}');
    expect(await readManifest(dir)).toEqual({ files: [], projects: [] });
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/manifest.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémenter**

`packages/backend/src/mods/manifest.ts` :

```ts
import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

/** Écrit par mc-image-helper dans /data : `files` relatifs à /data, `projects` = entrées demandées. */
export const MANIFEST_FILE = '.modrinth-manifest.json';
export interface ModrinthManifest { files: string[]; projects: string[] }

const normalizeRel = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

/** Absent, illisible ou invalide → null (journalisé en warn sauf ENOENT). */
export async function readManifest(dataDir: string): Promise<ModrinthManifest | null> {
  const file = path.join(dataDir, MANIFEST_FILE);
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file }, 'cannot read modrinth manifest'); return null; }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { logger.warn({ file }, 'modrinth manifest is not an object'); return null; }
    const m = parsed as Record<string, unknown>;
    return { files: strings(m.files).map(normalizeRel), projects: strings(m.projects) };
  } catch (err) { logger.warn({ err, file }, 'modrinth manifest is not valid JSON'); return null; }
}
```

- [ ] **Step 4 : lancer les tests**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/mods/manifest.ts packages/backend/src/mods/manifest.test.ts
git commit -m "feat(lot3): lecture tolérante du manifeste Modrinth de l'image itzg

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : client Modrinth, fake et modèle Prisma `ModrinthProject`

**Files:**
- Create: `packages/backend/src/mods/modrinth-client.ts`
- Create: `packages/backend/src/mods/fake-modrinth.ts`
- Modify: `packages/backend/prisma/schema.prisma` (ajouter le modèle à la fin)
- Test: `packages/backend/src/mods/modrinth-client.test.ts`

**Interfaces:**
- Produces: `interface ModrinthProjectInfo { id; slug; title; iconUrl: string | null; projectType: string; loaders: string[] }`, `interface ModrinthLike { getProject(slug: string): Promise<ModrinthProjectInfo | null> }`, `class ModrinthUnavailable extends Error`, `realModrinth(fetchFn?: typeof fetch): ModrinthLike`, `class FakeModrinth implements ModrinthLike { projects: Map<string, ModrinthProjectInfo>; down: boolean; calls: string[] }`, modèle Prisma `ModrinthProject`.

- [ ] **Step 1 : écrire les tests du client réel (fetch simulé)**

`packages/backend/src/mods/modrinth-client.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import { realModrinth, ModrinthUnavailable } from './modrinth-client.js';

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('realModrinth', () => {
  it('maps the API payload and sends a User-Agent', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', icon_url: 'https://cdn.modrinth.com/x.png', project_type: 'mod', loaders: ['fabric', 'quilt'] }));
    const info = await realModrinth(fetchFn as unknown as typeof fetch).getProject('lithium');
    expect(info).toEqual({ id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', iconUrl: 'https://cdn.modrinth.com/x.png', projectType: 'mod', loaders: ['fabric', 'quilt'] });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.modrinth.com/v2/project/lithium');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^mc-manager/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('encodes the slug and returns null on 404', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(404, { error: 'not_found' }));
    expect(await realModrinth(fetchFn as unknown as typeof fetch).getProject('a b')).toBeNull();
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('https://api.modrinth.com/v2/project/a%20b');
  });
  it('throws ModrinthUnavailable on other statuses, network errors and bad payloads', async () => {
    await expect(realModrinth(vi.fn().mockImplementation(() => json(500, {})) as unknown as typeof fetch).getProject('x')).rejects.toBeInstanceOf(ModrinthUnavailable);
    await expect(realModrinth(vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch).getProject('x')).rejects.toBeInstanceOf(ModrinthUnavailable);
    await expect(realModrinth(vi.fn().mockImplementation(() => json(200, { slug: 'x' })) as unknown as typeof fetch).getProject('x')).rejects.toBeInstanceOf(ModrinthUnavailable);
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/modrinth-client.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémenter le client et le fake**

`packages/backend/src/mods/modrinth-client.ts` :

```ts
export interface ModrinthProjectInfo { id: string; slug: string; title: string; iconUrl: string | null; projectType: string; loaders: string[] }

export interface ModrinthLike {
  /** null si le projet n'existe pas ; lève ModrinthUnavailable si l'API ne répond pas correctement. */
  getProject(slug: string): Promise<ModrinthProjectInfo | null>;
}

export class ModrinthUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ModrinthUnavailable'; }
}

const BASE = 'https://api.modrinth.com/v2';
/** Modrinth demande un User-Agent identifiant l'application et un contact. */
const USER_AGENT = 'mc-manager (https://github.com/coom/mc-manager)';
const TIMEOUT_MS = 10_000;

export function realModrinth(fetchFn: typeof fetch = fetch): ModrinthLike {
  return {
    async getProject(slug) {
      let res: Response;
      try {
        res = await fetchFn(`${BASE}/project/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) { throw new ModrinthUnavailable(`Modrinth request failed: ${(err as Error).message}`); }
      if (res.status === 404) return null;
      if (!res.ok) throw new ModrinthUnavailable(`Modrinth answered ${res.status}`);
      let body: unknown;
      try { body = await res.json(); } catch { throw new ModrinthUnavailable('Modrinth answered with invalid JSON'); }
      const b = body as Record<string, unknown>;
      if (!b || typeof b.id !== 'string' || typeof b.slug !== 'string' || typeof b.title !== 'string' || typeof b.project_type !== 'string') throw new ModrinthUnavailable('Modrinth answered with an unexpected payload');
      return {
        id: b.id, slug: b.slug, title: b.title,
        iconUrl: typeof b.icon_url === 'string' ? b.icon_url : null,
        projectType: b.project_type,
        loaders: Array.isArray(b.loaders) ? b.loaders.filter((l): l is string => typeof l === 'string') : [],
      };
    },
  };
}
```

`packages/backend/src/mods/fake-modrinth.ts` :

```ts
import { ModrinthUnavailable, type ModrinthLike, type ModrinthProjectInfo } from './modrinth-client.js';

export class FakeModrinth implements ModrinthLike {
  projects = new Map<string, ModrinthProjectInfo>();
  /** true : toute requête lève ModrinthUnavailable. */
  down = false;
  calls: string[] = [];
  add(p: Partial<ModrinthProjectInfo> & { slug: string }): void {
    this.projects.set(p.slug, { id: p.id ?? `id-${p.slug}`, slug: p.slug, title: p.title ?? p.slug, iconUrl: p.iconUrl ?? null, projectType: p.projectType ?? 'mod', loaders: p.loaders ?? ['fabric'] });
  }
  async getProject(slug: string): Promise<ModrinthProjectInfo | null> {
    this.calls.push(slug);
    if (this.down) throw new ModrinthUnavailable('fake down');
    return this.projects.get(slug) ?? null;
  }
}
```

- [ ] **Step 4 : ajouter le modèle Prisma et régénérer**

À la fin de `packages/backend/prisma/schema.prisma` :

```prisma
/// Métadonnées Modrinth mises en cache pour l'affichage de la page Mods (jamais nécessaires au fonctionnement).
model ModrinthProject {
  slug      String   @id
  projectId String
  title     String
  iconUrl   String?
  fetchedAt DateTime
}
```

Run: `pnpm db:generate && pnpm db:push`
Expected: client régénéré, base locale mise à jour (`testPrisma()` fait son propre `db push`).

- [ ] **Step 5 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/modrinth-client.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6 : commit**

```bash
git add packages/backend/src/mods/modrinth-client.ts packages/backend/src/mods/fake-modrinth.ts packages/backend/src/mods/modrinth-client.test.ts packages/backend/prisma/schema.prisma
git commit -m "feat(lot3): client Modrinth avec fake de test et cache ModrinthProject

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : `ModsService.view()`, agrégation en lecture

**Files:**
- Create: `packages/backend/src/mods/mods-service.ts`
- Test: `packages/backend/src/mods/mods-service.test.ts`

**Interfaces:**
- Consumes: `serverTypeOf`, `modrinthSource`, `COMPOSE_LINE`, `LISTING_RELATIVE` (tâche 2) ; `readListing`, `isManaged`, `slugOf` (tâche 3) ; `readManifest` (tâche 4) ; `ModrinthLike` (tâche 5) ; `DockerService.inspectServer()` ; `DataLock` ; `PrismaClient`.
- Produces: `class ModsService` avec `constructor(deps: ModsDeps)`, `view(): Promise<ModsView>`, `pendingResolution: Promise<void> | null` (pour les tests), et la méthode privée `listManual`. Les écritures arrivent en tâche 7.

```ts
export interface ModsDeps {
  dataDir: string;
  docker: Pick<DockerService, 'inspectServer'>;
  modrinth: ModrinthLike;
  prisma: PrismaClient;
  lock: DataLock;
  broadcast: (msg: WsMessage) => void;
}
```

- [ ] **Step 1 : écrire les tests de `view()`**

`packages/backend/src/mods/mods-service.test.ts` (ce fichier est complété en tâche 7 ; garder la même fabrique `setup`) :

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { WsMessage } from '@mc/common';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { testPrisma } from '../test-db.js';
import { DataLock } from '../data/data-lock.js';
import { FakeModrinth } from './fake-modrinth.js';
import { ModsService } from './mods-service.js';
import { MANIFEST_FILE } from './manifest.js';
import { AppError } from '../middleware/error-handler.js';

let prisma: PrismaClient;
beforeAll(() => { prisma = testPrisma(); });
afterAll(async () => { await prisma.$disconnect(); });

const LISTING = 'mc-manager/modrinth-projects.txt';

async function setup(opts: { env?: string[]; startedAt?: string | null; listing?: string; manifest?: object; mods?: Record<string, string>; noContainer?: boolean } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'mc-mods-'));
  if (opts.listing !== undefined) { await mkdir(path.join(dataDir, 'mc-manager'), { recursive: true }); await writeFile(path.join(dataDir, LISTING), opts.listing); }
  if (opts.manifest) await writeFile(path.join(dataDir, MANIFEST_FILE), JSON.stringify(opts.manifest));
  if (opts.mods) { await mkdir(path.join(dataDir, 'mods'), { recursive: true }); for (const [n, c] of Object.entries(opts.mods)) await writeFile(path.join(dataDir, 'mods', n), c); }
  const env = opts.env ?? ['TYPE=FABRIC', 'MODRINTH_PROJECTS=@/data/mc-manager/modrinth-projects.txt'];
  const startedAt = opts.startedAt === undefined ? '2026-10-11T10:00:00Z' : opts.startedAt;
  const docker = { inspectServer: vi.fn().mockResolvedValue(opts.noContainer ? null : { status: startedAt ? 'ready' : 'stopped', startedAt, tty: false, id: 'x', image: 'itzg', env }) };
  const modrinth = new FakeModrinth();
  const sent: WsMessage[] = [];
  const lock = new DataLock();
  const svc = new ModsService({ dataDir, docker, modrinth, prisma, lock, broadcast: (m) => sent.push(m) });
  return { dataDir, svc, modrinth, sent, lock, docker, listing: () => readFile(path.join(dataDir, LISTING), 'utf8'), modsDir: () => readdir(path.join(dataDir, 'mods')) };
}

describe('ModsService.view', () => {
  it('reports a missing container as unsupported with source none, without throwing', async () => {
    const { svc } = await setup({ noContainer: true });
    const v = await svc.view();
    expect(v.server).toBeNull();
    expect(v.source).toBe('none');
    expect(v.modrinth).toEqual([]);
    expect(v.manual).toEqual([]);
    expect(v.restartRequired).toBe(false);
  });
  it('reports a vanilla server as unsupported but still lists the file', async () => {
    const { svc } = await setup({ env: ['TYPE=VANILLA'], listing: 'lithium\n' });
    const v = await svc.view();
    expect(v.server).toBeNull();
    expect(v.modrinth.map((m) => m.entry)).toEqual(['lithium']);
  });
  it('aggregates listing, manifest, cache and the mods folder', async () => {
    await prisma.modrinthProject.create({ data: { slug: 'lithium', projectId: 'gvQqBUqZ', title: 'Lithium', iconUrl: 'https://cdn.modrinth.com/l.png', fetchedAt: new Date() } });
    const { svc, modrinth } = await setup({
      listing: '# header\nfabric-api\nlithium:0.14.0\n# spark\nbad entry\n',
      manifest: { files: ['mods/fabric-api.jar', 'mods/lithium.jar'], projects: ['fabric-api', 'lithium:0.14.0'] },
      mods: { 'fabric-api.jar': 'a', 'lithium.jar': 'b', 'custom.jar': 'c', 'old.jar.disabled': 'd', 'notes.txt': 'e' },
    });
    modrinth.add({ slug: 'fabric-api', title: 'Fabric API' });
    const v = await svc.view();
    expect(v.server).toEqual({ loader: 'fabric', dir: 'mods' });
    expect(v.source).toBe('file');
    expect(v.listingExists).toBe(true);
    expect(v.composeLine).toBe('MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"');
    expect(v.modrinth).toEqual([
      { entry: 'fabric-api', slug: 'fabric-api', enabled: true, installed: true, title: null, iconUrl: null, projectId: null },
      { entry: 'lithium:0.14.0', slug: 'lithium', enabled: true, installed: true, title: 'Lithium', iconUrl: 'https://cdn.modrinth.com/l.png', projectId: 'gvQqBUqZ' },
      { entry: 'spark', slug: 'spark', enabled: false, installed: false, title: null, iconUrl: null, projectId: null },
    ]);
    expect(v.unmanagedLines).toEqual([{ raw: '# header', invalid: false }, { raw: 'bad entry', invalid: true }]);
    expect(v.manual.map((m) => [m.file, m.enabled, m.conflict])).toEqual([['custom.jar', true, false], ['old.jar', false, false]]);
    expect(v.manual[0].size).toBe(1);
    expect(v.restartRequired).toBe(false);
    // Résolution en arrière-plan des entrées sans cache : fabric-api et spark, une seule fois.
    await svc.pendingResolution;
    expect(modrinth.calls.sort()).toEqual(['fabric-api', 'spark']);
    const v2 = await svc.view();
    expect(v2.modrinth[0].title).toBe('Fabric API');
    await svc.pendingResolution;
    expect(modrinth.calls.length).toBe(2); // spark inconnu : pas de nouvelle tentative avant une heure
  });
  it('requires a restart when active entries differ from the manifest, by slug', async () => {
    const { svc } = await setup({ listing: 'lithium\n# spark\n', manifest: { files: [], projects: ['lithium', 'spark'] } });
    expect((await svc.view()).restartRequired).toBe(true);
    const { svc: svc2 } = await setup({ listing: 'lithium:0.14.0\n', manifest: { files: [], projects: ['lithium'] } });
    expect((await svc2.view()).restartRequired).toBe(false);
    const { svc: svc3 } = await setup({ listing: 'lithium\n' }); // manifeste absent
    expect((await svc3.view()).restartRequired).toBe(true);
    const { svc: svc4 } = await setup({ listing: '# lithium\n' });
    expect((await svc4.view()).restartRequired).toBe(false);
  });
  it('hides both forms of a Modrinth-managed jar and flags a manual conflict', async () => {
    const { svc } = await setup({ manifest: { files: ['mods/lithium.jar'], projects: ['lithium'] }, listing: 'lithium\n', mods: { 'lithium.jar': 'a', 'lithium.jar.disabled': 'b', 'x.jar': 'c', 'x.jar.disabled': 'd' } });
    const v = await svc.view();
    expect(v.manual).toEqual([expect.objectContaining({ file: 'x.jar', enabled: true, conflict: true })]);
  });
  it('tolerates a missing mods folder', async () => {
    const { svc } = await setup({ listing: '' });
    expect((await svc.view()).manual).toEqual([]);
  });
  it('exposes inline entries for the import card', async () => {
    const { svc } = await setup({ env: ['TYPE=FABRIC', 'MODRINTH_PROJECTS=fabric-api,lithium'] });
    const v = await svc.view();
    expect(v.source).toBe('inline');
    expect(v.inlineEntries).toEqual(['fabric-api', 'lithium']);
    expect(v.listingExists).toBe(false);
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/mods-service.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémenter la lecture**

`packages/backend/src/mods/mods-service.ts` :

```ts
import { readdir, stat } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { ManualMod, ModsDir, ModsView, ModrinthMod, WsMessage } from '@mc/common';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { logger } from '../utils/logger.js';
import { serverTypeOf, modrinthSource, COMPOSE_LINE, LISTING_RELATIVE } from './server-type.js';
import { readListing, isManaged, slugOf, type ListingLine } from './listing-file.js';
import { readManifest } from './manifest.js';
import type { ModrinthLike } from './modrinth-client.js';

export interface ModsDeps {
  dataDir: string;
  docker: Pick<DockerService, 'inspectServer'>;
  modrinth: ModrinthLike;
  prisma: PrismaClient;
  lock: DataLock;
  broadcast: (msg: WsMessage) => void;
}

const RESOLVE_RETRY_MS = 60 * 60_000;

export class ModsService {
  readonly listingPath: string;
  /** Dernier renommage manuel (mémoire seulement) : comparé à StartedAt pour restartRequired. */
  protected lastFileWriteAt: Date | null = null;
  /** Promesse de la résolution en arrière-plan en cours (les tests l'attendent). */
  pendingResolution: Promise<void> | null = null;
  private attempted = new Map<string, number>();

  constructor(protected deps: ModsDeps) { this.listingPath = path.join(deps.dataDir, LISTING_RELATIVE); }

  protected async inspect() { return this.deps.docker.inspectServer().catch((err) => { logger.warn({ err }, 'docker inspect failed'); return null; }); }

  async view(): Promise<ModsView> {
    const inspect = await this.inspect();
    const env = inspect?.env ?? [];
    const server = inspect ? serverTypeOf(env) : null;
    const { source, inlineEntries } = modrinthSource(env);
    const { exists, lines } = await readListing(this.listingPath);
    const manifest = await readManifest(this.deps.dataDir);
    const manifestSlugs = new Set((manifest?.projects ?? []).map(slugOf));
    const manifestFiles = new Set(manifest?.files ?? []);
    const managed = lines.filter(isManaged);
    const slugs = [...new Set(managed.map((l) => slugOf(l.entry)))];
    const cached = slugs.length ? await this.deps.prisma.modrinthProject.findMany({ where: { slug: { in: slugs } } }) : [];
    const bySlug = new Map(cached.map((c) => [c.slug, c]));
    const modrinth: ModrinthMod[] = managed.map((l) => {
      const slug = slugOf(l.entry);
      const c = bySlug.get(slug);
      return { entry: l.entry, slug, enabled: l.kind === 'entry', installed: manifestSlugs.has(slug), title: c?.title ?? null, iconUrl: c?.iconUrl ?? null, projectId: c?.projectId ?? null };
    });
    const unmanagedLines = lines.filter((l) => l.kind === 'comment' || l.kind === 'invalid').map((l) => ({ raw: l.raw, invalid: l.kind === 'invalid' }));
    const manual = server ? await this.listManual(server.dir, manifestFiles) : [];
    const active = new Set(modrinth.filter((m) => m.enabled).map((m) => m.slug));
    const modrinthPending = active.size !== manifestSlugs.size || [...active].some((s) => !manifestSlugs.has(s));
    const manualPending = !!inspect?.startedAt && this.lastFileWriteAt !== null && new Date(inspect.startedAt).getTime() < this.lastFileWriteAt.getTime();
    this.scheduleResolution(slugs.filter((s) => !bySlug.has(s)));
    return { server, source, inlineEntries, listingExists: exists, composeLine: COMPOSE_LINE, restartRequired: modrinthPending || manualPending, modrinth, unmanagedLines, manual };
  }

  /** Jars du dossier non gérés par Modrinth (ni le .jar ni son .jar.disabled n'est dans le manifeste). */
  protected async listManual(dir: ModsDir, manifestFiles: Set<string>): Promise<ManualMod[]> {
    const abs = path.join(this.deps.dataDir, dir);
    let entries: Dirent[];
    try { entries = await readdir(abs, { withFileTypes: true }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
    const byBase = new Map<string, { enabled?: { size: number; mtime: Date }; disabled?: { size: number; mtime: Date } }>();
    for (const d of entries) {
      if (!d.isFile()) continue;
      const n = d.name;
      const on = n.endsWith('.jar');
      if (!on && !n.endsWith('.jar.disabled')) continue;
      const base = on ? n : n.slice(0, -'.disabled'.length);
      if (manifestFiles.has(`${dir}/${base}`)) continue;
      const st = await stat(path.join(abs, n));
      const rec = byBase.get(base) ?? {};
      rec[on ? 'enabled' : 'disabled'] = { size: st.size, mtime: st.mtime };
      byBase.set(base, rec);
    }
    return [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, r]) => {
      const info = r.enabled ?? r.disabled!;
      return { file, enabled: !!r.enabled, size: info.size, mtime: info.mtime.toISOString(), conflict: !!r.enabled && !!r.disabled };
    });
  }

  /** Résout en arrière-plan les slugs sans cache, au plus une tentative par slug et par heure, un passage à la fois. */
  private scheduleResolution(slugs: string[]): void {
    const now = Date.now();
    const todo = slugs.filter((s) => (this.attempted.get(s) ?? 0) + RESOLVE_RETRY_MS < now);
    if (!todo.length || this.pendingResolution) return;
    for (const s of todo) this.attempted.set(s, now);
    this.pendingResolution = (async () => {
      for (const slug of todo) {
        try {
          const info = await this.deps.modrinth.getProject(slug);
          if (info) await this.cacheProject(slug, info);
        } catch (err) { logger.warn({ err, slug }, 'modrinth metadata resolution failed'); }
      }
    })().finally(() => { this.pendingResolution = null; });
  }

  protected async cacheProject(slug: string, info: { id: string; title: string; iconUrl: string | null }): Promise<void> {
    const data = { projectId: info.id, title: info.title, iconUrl: info.iconUrl, fetchedAt: new Date() };
    await this.deps.prisma.modrinthProject.upsert({ where: { slug }, create: { slug, ...data }, update: data });
  }
}
```

- [ ] **Step 4 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/mods-service.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/mods/mods-service.ts packages/backend/src/mods/mods-service.test.ts
git commit -m "feat(lot3): ModsService, vue agrégée des mods Modrinth et manuels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : `ModsService`, écritures (import, add, toggle, remove, renommage)

**Files:**
- Modify: `packages/backend/src/mods/mods-service.ts`
- Test: `packages/backend/src/mods/mods-service.test.ts` (ajout d'un bloc `describe`)

**Interfaces:**
- Consumes: `writeListing`, `isValidEntry`, `prefixOf` (tâche 3), `ModrinthUnavailable` (tâche 5), `mapWriteError` (tâche 3), `AppError` avec `code` (tâche 1).
- Produces: `importFromEnv(): Promise<number>`, `add(entry: string): Promise<void>`, `setEnabled(entry: string, enabled: boolean): Promise<void>`, `remove(entry: string): Promise<void>`, `setFileEnabled(file: string, enabled: boolean): Promise<void>`. Toutes lèvent `AppError` avec un `code` de `ModsErrorCode`.

- [ ] **Step 1 : ajouter les tests des écritures**

À la suite du premier `describe` de `packages/backend/src/mods/mods-service.test.ts` :

```ts
const codeOf = async (p: Promise<unknown>): Promise<[number, string | undefined]> => {
  try { await p; return [200, undefined]; } catch (err) { return [(err as AppError).statusCode, (err as AppError).code]; }
};

describe('ModsService writes', () => {
  it('imports the inline list once, keeping invalid entries as invalid lines', async () => {
    const { svc, sent, listing } = await setup({ env: ['TYPE=FABRIC', 'MODRINTH_PROJECTS=fabric-api, lithium,bad entry'] });
    expect(await svc.importFromEnv()).toBe(3);
    expect(await listing()).toBe('fabric-api\nlithium\nbad entry\n');
    expect(sent).toEqual([{ type: 'mods.changed' }]);
    expect(await codeOf(svc.importFromEnv())).toEqual([409, 'conflict']);
    const { svc: svc2 } = await setup({ listing: '' });
    expect(await codeOf(svc2.importFromEnv())).toEqual([409, 'conflict']);
    const { svc: svc3 } = await setup({ env: ['TYPE=FABRIC'] });
    expect(await codeOf(svc3.importFromEnv())).toEqual([409, 'conflict']);
  });
  it('adds a verified entry, caches its metadata and refuses duplicates case-insensitively', async () => {
    const { svc, modrinth, listing, sent } = await setup({ listing: 'fabric-api\n' });
    modrinth.add({ slug: 'lithium', id: 'gvQqBUqZ', title: 'Lithium', iconUrl: 'https://cdn.modrinth.com/l.png', loaders: ['fabric', 'quilt'] });
    await svc.add('Lithium:0.14.0');
    expect(await listing()).toBe('fabric-api\nLithium:0.14.0\n');
    expect(modrinth.calls).toEqual(['lithium']);
    expect(await prisma.modrinthProject.findUnique({ where: { slug: 'lithium' } })).toMatchObject({ projectId: 'gvQqBUqZ', title: 'Lithium' });
    expect(sent).toEqual([{ type: 'mods.changed' }]);
    expect(await codeOf(svc.add('lithium'))).toEqual([409, 'duplicate']);
    expect(await codeOf(svc.add('fabric-api'))).toEqual([409, 'duplicate']);
  });
  it('maps Modrinth answers to error codes and never writes on failure', async () => {
    const { svc, modrinth, listing } = await setup({ listing: '' });
    expect(await codeOf(svc.add('bad entry'))).toEqual([400, 'invalid_entry']);
    expect(await codeOf(svc.add('nope'))).toEqual([404, 'unknown_project']);
    modrinth.add({ slug: 'pack', projectType: 'modpack' });
    expect(await codeOf(svc.add('pack'))).toEqual([422, 'wrong_type']);
    modrinth.add({ slug: 'plugin', loaders: ['paper'] });
    expect(await codeOf(svc.add('plugin'))).toEqual([422, 'loader_mismatch']);
    modrinth.add({ slug: 'terralith', loaders: ['datapack'] });
    expect(await codeOf(svc.add('datapack:terralith'))).toEqual([200, undefined]); // préfixe explicite : loader demandé = datapack
    modrinth.down = true;
    expect(await codeOf(svc.add('lithium'))).toEqual([502, 'modrinth_unavailable']);
    expect(await listing()).toBe('datapack:terralith\n');
  });
  it('refuses writes on an unsupported server or while the data lock is held', async () => {
    const { svc } = await setup({ env: ['TYPE=VANILLA'], listing: 'lithium\n' });
    expect(await codeOf(svc.add('spark'))).toEqual([409, 'unsupported_server']);
    expect(await codeOf(svc.setEnabled('lithium', false))).toEqual([409, 'unsupported_server']);
    const { svc: svc2, lock } = await setup({ listing: 'lithium\n' });
    const release = lock.acquire('restore');
    expect(await codeOf(svc2.setEnabled('lithium', false))).toEqual([409, 'busy']);
    release();
    await svc2.setEnabled('lithium', false);
  });
  it('toggles and removes entries, preserving the other lines', async () => {
    const { svc, listing, sent } = await setup({ listing: '# header\nfabric-api\n# lithium\nbad entry\n' });
    await svc.setEnabled('lithium', true);
    expect(await listing()).toBe('# header\nfabric-api\nlithium\nbad entry\n');
    await svc.setEnabled('fabric-api', false);
    expect(await listing()).toBe('# header\n# fabric-api\nlithium\nbad entry\n');
    await svc.setEnabled('lithium', true); // déjà actif : pas d'écriture ni de broadcast
    expect(sent.length).toBe(2);
    await svc.remove('lithium');
    expect(await listing()).toBe('# header\n# fabric-api\nbad entry\n');
    expect(await codeOf(svc.setEnabled('lithium', true))).toEqual([404, 'not_found']);
    expect(await codeOf(svc.remove('nope'))).toEqual([404, 'not_found']);
    expect(await codeOf(svc.setEnabled('bad entry', true))).toEqual([400, 'invalid_entry']);
  });
  it('renames manual jars, flags a restart and refuses conflicts and unknown files', async () => {
    const { svc, modsDir, sent } = await setup({ listing: '', manifest: { files: ['mods/lithium.jar'], projects: [] }, mods: { 'custom.jar': 'a', 'old.jar.disabled': 'b', 'x.jar': 'c', 'x.jar.disabled': 'd', 'lithium.jar': 'e' } });
    expect((await svc.view()).restartRequired).toBe(false);
    await svc.setFileEnabled('custom.jar', false);
    await svc.setFileEnabled('old.jar', true);
    expect((await modsDir()).sort()).toEqual(['custom.jar.disabled', 'lithium.jar', 'old.jar', 'x.jar', 'x.jar.disabled']);
    expect(sent).toEqual([{ type: 'mods.changed' }, { type: 'mods.changed' }]);
    expect((await svc.view()).restartRequired).toBe(true);
    await svc.setFileEnabled('old.jar', true); // déjà actif : rien
    expect(sent.length).toBe(2);
    expect(await codeOf(svc.setFileEnabled('x.jar', false))).toEqual([409, 'conflict']);
    expect(await codeOf(svc.setFileEnabled('lithium.jar', false))).toEqual([404, 'not_found']); // géré par Modrinth
    expect(await codeOf(svc.setFileEnabled('../custom.jar', false))).toEqual([404, 'not_found']);
    expect(await codeOf(svc.setFileEnabled('nope.jar', false))).toEqual([404, 'not_found']);
  });
  it('does not flag a manual restart when the server is stopped', async () => {
    const { svc } = await setup({ listing: '', startedAt: null, mods: { 'custom.jar': 'a' } });
    await svc.setFileEnabled('custom.jar', false);
    expect((await svc.view()).restartRequired).toBe(false);
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/mods-service.test.ts -t "writes"`
Expected: FAIL, méthodes absentes.

- [ ] **Step 3 : implémenter les écritures**

Compléter les imports de `mods-service.ts` :

```ts
import { access, rename } from 'fs/promises';
import { AppError } from '../middleware/error-handler.js';
import { mapWriteError } from '../utils/atomic-write.js';
import { readListing, writeListing, isManaged, isValidEntry, slugOf, prefixOf, type ListingLine } from './listing-file.js';
import { ModrinthUnavailable, type ModrinthLike } from './modrinth-client.js';
```

et ajouter à la classe :

```ts
  private fail(status: number, code: string, message: string): never { throw new AppError(status, message, undefined, code); }

  private async requireServer() {
    const inspect = await this.inspect();
    const server = inspect ? serverTypeOf(inspect.env) : null;
    if (!server) this.fail(409, 'unsupported_server', 'Mods are only managed for modded or plugin servers (TYPE=FABRIC, PAPER, ...)');
    return server;
  }

  /** Exécute `fn` sous le verrou de données, puis diffuse mods.changed si `fn` renvoie true. */
  private async withLock<T>(fn: () => Promise<{ changed: boolean; result: T }>): Promise<T> {
    const release = this.deps.lock.acquire('mods');
    try {
      const { changed, result } = await fn();
      if (changed) this.deps.broadcast({ type: 'mods.changed' });
      return result;
    } finally { release(); }
  }

  /** Crée le fichier de liste à partir de MODRINTH_PROJECTS inline ; renvoie le nombre d'entrées écrites. */
  async importFromEnv(): Promise<number> {
    await this.requireServer();
    const inspect = await this.inspect();
    const { source, inlineEntries } = modrinthSource(inspect?.env ?? []);
    if (source !== 'inline') this.fail(409, 'conflict', 'MODRINTH_PROJECTS is not an inline list');
    return this.withLock(async () => {
      if ((await readListing(this.listingPath)).exists) this.fail(409, 'conflict', 'The listing file already exists');
      const lines: ListingLine[] = inlineEntries.map((e) => (isValidEntry(e) ? { kind: 'entry', entry: e, raw: e } : { kind: 'invalid', raw: e }));
      await writeListing(this.listingPath, lines);
      return { changed: true, result: lines.length };
    });
  }

  async add(entry: string): Promise<void> {
    if (!isValidEntry(entry)) this.fail(400, 'invalid_entry', 'Invalid Modrinth entry');
    const server = await this.requireServer();
    const slug = slugOf(entry);
    const dup = (lines: ListingLine[]) => lines.some((l) => isManaged(l) && slugOf(l.entry) === slug);
    if (dup((await readListing(this.listingPath)).lines)) this.fail(409, 'duplicate', `${slug} is already listed`);
    // Appel Modrinth hors verrou (jusqu'à 10 s) ; le doublon est revérifié sous verrou avant d'écrire.
    let info;
    try { info = await this.deps.modrinth.getProject(slug); }
    catch (err) { if (err instanceof ModrinthUnavailable) this.fail(502, 'modrinth_unavailable', err.message); throw err; }
    if (!info) this.fail(404, 'unknown_project', `Modrinth project ${slug} not found`);
    if (info.projectType !== 'mod') this.fail(422, 'wrong_type', `${slug} is a ${info.projectType}, not a mod`);
    const wanted = prefixOf(entry) ?? server.loader;
    if (!info.loaders.includes(wanted)) this.fail(422, 'loader_mismatch', `${slug} has no ${wanted} version (loaders: ${info.loaders.join(', ') || 'none'})`);
    await this.cacheProject(slug, info);
    await this.withLock(async () => {
      const { lines } = await readListing(this.listingPath);
      if (dup(lines)) this.fail(409, 'duplicate', `${slug} is already listed`);
      await writeListing(this.listingPath, [...lines, { kind: 'entry', entry, raw: entry }]);
      return { changed: true, result: undefined };
    });
  }

  private findLine(lines: ListingLine[], entry: string): number {
    if (!isValidEntry(entry)) this.fail(400, 'invalid_entry', 'Invalid Modrinth entry');
    const i = lines.findIndex((l) => isManaged(l) && l.entry === entry);
    if (i < 0) this.fail(404, 'not_found', `${entry} is not listed`);
    return i;
  }

  async setEnabled(entry: string, enabled: boolean): Promise<void> {
    await this.requireServer();
    await this.withLock(async () => {
      const { lines } = await readListing(this.listingPath);
      const i = this.findLine(lines, entry);
      const kind = enabled ? 'entry' : 'disabled';
      if (lines[i].kind === kind) return { changed: false, result: undefined };
      const next = [...lines];
      next[i] = { kind, entry, raw: enabled ? entry : `# ${entry}` };
      await writeListing(this.listingPath, next);
      return { changed: true, result: undefined };
    });
  }

  async remove(entry: string): Promise<void> {
    await this.requireServer();
    await this.withLock(async () => {
      const { lines } = await readListing(this.listingPath);
      const i = this.findLine(lines, entry);
      await writeListing(this.listingPath, lines.filter((_, j) => j !== i));
      return { changed: true, result: undefined };
    });
  }

  /** Renomme <file> ⇄ <file>.disabled dans le dossier des mods ; `file` doit être un nom simple présent dans le listing manuel. */
  async setFileEnabled(file: string, enabled: boolean): Promise<void> {
    if (!/^[^/\\]+\.jar$/.test(file) || file.includes('..') || path.basename(file) !== file) this.fail(404, 'not_found', 'Unknown file');
    const server = await this.requireServer();
    await this.withLock(async () => {
      const manifest = await readManifest(this.deps.dataDir);
      const manual = await this.listManual(server.dir, new Set(manifest?.files ?? []));
      const m = manual.find((x) => x.file === file);
      if (!m) this.fail(404, 'not_found', 'Unknown file');
      if (m.conflict) this.fail(409, 'conflict', `${file} and ${file}.disabled both exist: remove one on the host`);
      if (m.enabled === enabled) return { changed: false, result: undefined };
      const dir = path.join(this.deps.dataDir, server.dir);
      const from = path.join(dir, enabled ? `${file}.disabled` : file);
      const to = path.join(dir, enabled ? file : `${file}.disabled`);
      if (await access(to).then(() => true, () => false)) this.fail(409, 'conflict', `${path.basename(to)} already exists`);
      try { await rename(from, to); } catch (err) { throw mapWriteError(err, from, dir); }
      this.lastFileWriteAt = new Date();
      return { changed: true, result: undefined };
    });
  }
```

- [ ] **Step 4 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/mods/mods-service.ts packages/backend/src/mods/mods-service.test.ts
git commit -m "feat(lot3): import, ajout, activation, retrait des mods Modrinth et renommage des jars manuels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : routes `/api/mods`, montage et démarrage

**Files:**
- Create: `packages/backend/src/routes/mods.routes.ts`
- Modify: `packages/backend/src/app.ts` (montage après `/api/journal`)
- Modify: `packages/backend/src/index.ts` (après `app.locals.properties = …`)
- Test: `packages/backend/src/routes/mods.routes.test.ts`

**Interfaces:**
- Consumes: `ModsService` (tâches 6 et 7), `requireRole`, `audit`, `AppError`.
- Produces: `modsRoutes: Router`, `app.locals.mods: ModsService`.

- [ ] **Step 1 : écrire les tests de routes**

`packages/backend/src/routes/mods.routes.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { modsRoutes } from './mods.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

const view = { server: { loader: 'fabric', dir: 'mods' }, source: 'file', inlineEntries: [], listingExists: true, composeLine: 'x', restartRequired: false, modrinth: [], unmanagedLines: [], manual: [] };

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.mods = {
    view: vi.fn().mockResolvedValue(view), importFromEnv: vi.fn().mockResolvedValue(3), add: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), setFileEnabled: vi.fn().mockResolvedValue(undefined),
  };
  app.use('/api/mods', modsRoutes);
  app.use(errorHandler);
  return app;
}
const audited = (app: express.Express) => (app.locals.prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[0].data.action, c[0].data.detail]);

describe('mods routes', () => {
  it('lets a viewer read but not write', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/mods')).status).toBe(200);
    expect((await request(app).post('/api/mods/import')).status).toBe(403);
    expect((await request(app).post('/api/mods/modrinth').send({ entry: 'lithium' })).status).toBe(403);
    expect((await request(app).patch('/api/mods/modrinth/lithium').send({ enabled: false })).status).toBe(403);
    expect((await request(app).delete('/api/mods/modrinth/lithium')).status).toBe(403);
    expect((await request(app).patch('/api/mods/files/x.jar').send({ enabled: false })).status).toBe(403);
    expect(audited(app)).toEqual([]);
  });
  it('admin writes are applied, audited and answered with the fresh view', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/mods/import')).body).toEqual(view);
    expect((await request(app).post('/api/mods/modrinth').send({ entry: 'lithium:0.14.0' })).status).toBe(200);
    expect((await request(app).patch('/api/mods/modrinth/pl3xmap%3F').send({ enabled: false })).status).toBe(200);
    expect((await request(app).delete('/api/mods/modrinth/lithium%3A0.14.0')).status).toBe(200);
    expect((await request(app).patch('/api/mods/files/My%20Mod.jar').send({ enabled: true })).status).toBe(200);
    expect(app.locals.mods.add).toHaveBeenCalledWith('lithium:0.14.0');
    expect(app.locals.mods.setEnabled).toHaveBeenCalledWith('pl3xmap?', false);
    expect(app.locals.mods.remove).toHaveBeenCalledWith('lithium:0.14.0');
    expect(app.locals.mods.setFileEnabled).toHaveBeenCalledWith('My Mod.jar', true);
    expect(audited(app)).toEqual([['mods.import', '3 entries'], ['mods.add', 'lithium:0.14.0'], ['mods.toggle', 'pl3xmap? disabled'], ['mods.remove', 'lithium:0.14.0'], ['mods.file.toggle', 'My Mod.jar enabled']]);
  });
  it('validates bodies and path parameters before calling the service', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/mods/modrinth').send({})).status).toBe(400);
    expect((await request(app).post('/api/mods/modrinth').send({ entry: 'bad entry' })).body.code).toBe('invalid_entry');
    expect((await request(app).patch('/api/mods/modrinth/lithium').send({ enabled: 'yes' })).status).toBe(400);
    expect((await request(app).patch('/api/mods/modrinth/..%2Fx').send({ enabled: true })).body.code).toBe('invalid_entry');
    expect((await request(app).patch('/api/mods/files/..%2Fx.jar').send({ enabled: true })).status).toBe(404);
    expect((await request(app).patch('/api/mods/files/x.txt').send({ enabled: true })).status).toBe(404);
    expect(app.locals.mods.add).not.toHaveBeenCalled();
    expect(app.locals.mods.setEnabled).not.toHaveBeenCalled();
    expect(app.locals.mods.setFileEnabled).not.toHaveBeenCalled();
    expect(audited(app)).toEqual([]);
  });
  it('surfaces service errors with their code and does not audit them', async () => {
    const app = appWith('admin');
    app.locals.mods.add.mockRejectedValue(new AppError(422, 'no fabric version', undefined, 'loader_mismatch'));
    const res = await request(app).post('/api/mods/modrinth').send({ entry: 'plugin' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'no fabric version', code: 'loader_mismatch' });
    expect(audited(app)).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/mods.routes.test.ts`
Expected: FAIL, module introuvable.

- [ ] **Step 3 : implémenter les routes**

`packages/backend/src/routes/mods.routes.ts` :

```ts
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { isValidEntry } from '../mods/listing-file.js';

export const modsRoutes: Router = Router();
const admin = requireRole('admin');

const entryParam = (req: Request): string => {
  const entry = req.params.entry;
  if (!isValidEntry(entry)) throw new AppError(400, 'Invalid Modrinth entry', undefined, 'invalid_entry');
  return entry;
};
const fileParam = (req: Request): string => {
  const file = req.params.file;
  if (!/^[^/\\]+\.jar$/.test(file) || file.includes('..')) throw new AppError(404, 'Unknown file', undefined, 'not_found');
  return file;
};
const enabledBody = (req: Request): boolean => {
  const v = req.body?.enabled;
  if (typeof v !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
  return v;
};

modsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.mods.view()); } catch (err) { next(err); }
});

modsRoutes.post('/import', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const n: number = await req.app.locals.mods.importFromEnv();
    await audit(req, 'mods.import', `${n} entries`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.post('/modrinth', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = req.body?.entry;
    if (typeof entry !== 'string' || !entry.trim()) throw new AppError(400, 'entry is required');
    if (!isValidEntry(entry.trim())) throw new AppError(400, 'Invalid Modrinth entry', undefined, 'invalid_entry');
    await req.app.locals.mods.add(entry.trim());
    await audit(req, 'mods.add', entry.trim());
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.patch('/modrinth/:entry', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = entryParam(req);
    const enabled = enabledBody(req);
    await req.app.locals.mods.setEnabled(entry, enabled);
    await audit(req, 'mods.toggle', `${entry} ${enabled ? 'enabled' : 'disabled'}`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.delete('/modrinth/:entry', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = entryParam(req);
    await req.app.locals.mods.remove(entry);
    await audit(req, 'mods.remove', entry);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.patch('/files/:file', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = fileParam(req);
    const enabled = enabledBody(req);
    await req.app.locals.mods.setFileEnabled(file, enabled);
    await audit(req, 'mods.file.toggle', `${file} ${enabled ? 'enabled' : 'disabled'}`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});
```

- [ ] **Step 4 : monter les routes et câbler le service**

Dans `packages/backend/src/app.ts` : importer `modsRoutes` depuis `./routes/mods.routes.js` et ajouter `app.use('/api/mods', modsRoutes);` juste après la ligne `app.use('/api/journal', journalRoutes);`.

Dans `packages/backend/src/index.ts` : importer `ModsService` depuis `./mods/mods-service.js` et `realModrinth` depuis `./mods/modrinth-client.js`, puis juste après `app.locals.properties = new PropertiesService(...)` :

```ts
  // Mods (lot 3) : liste Modrinth gérée dans /data/mc-manager, jars manuels renommés dans mods/ ; écritures sous le même verrou.
  app.locals.mods = new ModsService({ dataDir: config.mc.dataDir, docker, modrinth: realModrinth(), prisma, lock: backups.dataLock, broadcast: (msg) => broadcast(wss, msg) });
```

- [ ] **Step 5 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/mods.routes.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6 : vérifier le démarrage à blanc**

Run (depuis la racine, avec un `.env` valide) : `pnpm --filter @mc/backend exec tsx src/index.ts` pendant quelques secondes puis Ctrl+C.
Expected: `MC Manager backend on http://localhost:3001` dans les logs, sans erreur de démarrage (le conteneur peut être absent, le service répond alors `server: null`).

- [ ] **Step 7 : commit**

```bash
git add packages/backend/src/routes/mods.routes.ts packages/backend/src/routes/mods.routes.test.ts packages/backend/src/app.ts packages/backend/src/index.ts
git commit -m "feat(lot3): routes /api/mods, admin, auditées, câblées au démarrage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : frontend, client API, WebSocket, navigation, bandeau partagé, i18n

**Files:**
- Create: `packages/frontend/src/api/mods.api.ts`
- Create: `packages/frontend/scripts/i18n-fragments/mods.json`
- Modify: `packages/frontend/scripts/i18n-fragments/nav.json`, `audit.json`
- Modify: `packages/frontend/src/hooks/use-websocket.ts`
- Modify: `packages/frontend/src/components/layout/Sidebar.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Modify: `packages/frontend/src/pages/Audit.tsx` (constante `ACTIONS`)
- Move: `packages/frontend/src/components/config/RestartBanner.tsx` → `packages/frontend/src/components/shared/RestartBanner.tsx` (et l'import dans `pages/Config.tsx`)
- Test: `packages/frontend/src/hooks/use-websocket.test.ts` (ajout d'un cas)

**Interfaces:**
- Produces: `modsApi` (`get`, `import`, `add(entry)`, `toggle(entry, enabled)`, `remove(entry)`, `toggleFile(file, enabled)`, chaque méthode renvoie `Promise<ModsView>`), route `/mods` montée sur un composant `Mods` (créé en tâche 10 ; ici un placeholder temporaire n'est PAS nécessaire : créer `pages/Mods.tsx` minimal renvoyant `<div />` sera remplacé en tâche 10), clés i18n `mods.*`, `nav.mods`, `audit.actions.mods`.

- [ ] **Step 1 : écrire le client API**

`packages/frontend/src/api/mods.api.ts` :

```ts
import api from './client';
import type { ModsView } from '@mc/common';

const data = (p: Promise<{ data: ModsView }>): Promise<ModsView> => p.then((r) => r.data);

export const modsApi = {
  get: (): Promise<ModsView> => data(api.get('/mods')),
  import: (): Promise<ModsView> => data(api.post('/mods/import')),
  add: (entry: string): Promise<ModsView> => data(api.post('/mods/modrinth', { entry })),
  toggle: (entry: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/modrinth/${encodeURIComponent(entry)}`, { enabled })),
  remove: (entry: string): Promise<ModsView> => data(api.delete(`/mods/modrinth/${encodeURIComponent(entry)}`)),
  toggleFile: (file: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/files/${encodeURIComponent(file)}`, { enabled })),
};
```

- [ ] **Step 2 : écrire le fragment i18n et fusionner**

`packages/frontend/scripts/i18n-fragments/mods.json` :

```json
{ "namespace": "mods", "keys": {
  "en": {
    "title": "Mods",
    "unsupported": { "title": "Mods are not managed for this server", "description": "The Minecraft container must run a modded or plugin server (TYPE=FABRIC, QUILT, FORGE, NEOFORGE, PAPER, ...). Vanilla servers have no mods folder." },
    "source": {
      "inline": { "title": "The mod list still lives in your compose file", "description": "Import it once, then point MODRINTH_PROJECTS to the file managed by MC Manager so that your changes apply at the next restart." },
      "other": { "title": "MODRINTH_PROJECTS points to another listing file", "description": "MC Manager only manages its own file. Point the variable to it so that your changes apply at the next restart." },
      "none": { "title": "MODRINTH_PROJECTS is not set on the container", "description": "Add this line to the environment of the Minecraft container so that the list below is applied at the next restart." }
    },
    "composeLine": "Line to add to the container environment",
    "copy": "Copy", "copied": "Copied",
    "import": "Import {{count}} mod(s)", "imported": "Mod list imported",
    "restartRequired": "Restart required: the server loads mods at startup only.",
    "modrinth": { "title": "Modrinth mods", "empty": "No Modrinth mod listed yet.", "installed": "Installed", "absent": "Not installed", "pending": "Pending restart", "unmanaged": "Lines kept as-is", "invalidLine": "Unrecognized line" },
    "add": { "placeholder": "Project slug, e.g. lithium or lithium:0.14.0", "button": "Add", "hint": "The slug is the last part of the project URL on modrinth.com." },
    "added": "Mod added", "removed": "Mod removed",
    "remove": { "button": "Remove", "title": "Remove {{entry}} from the list?", "description": "The image deletes its jar at the next restart. You can add it again later." },
    "enable": "Enable", "disable": "Disable",
    "manual": { "title": "Manual jars", "description": "Files dropped by hand in the mods folder; disabled ones are renamed .jar.disabled.", "empty": "No jar dropped by hand.", "conflict": "Both .jar and .jar.disabled exist: remove one on the host." },
    "errors": {
      "invalid_entry": "Invalid entry: use a Modrinth slug, optionally with :version, a loader prefix or a trailing ?.",
      "duplicate": "This project is already listed.",
      "unknown_project": "No Modrinth project with this slug.",
      "wrong_type": "This Modrinth project is not a mod (modpack, resource pack or shader).",
      "loader_mismatch": "This project has no version for the server loader.",
      "modrinth_unavailable": "Modrinth could not be reached. Try again later.",
      "unsupported_server": "Mods are not managed for this server type.",
      "busy": "Another data operation is running (backup, restore or configuration). Try again in a moment.",
      "conflict": "Conflicting state on disk: check the mods folder on the host.",
      "not_found": "This mod is no longer listed."
    }
  },
  "fr": {
    "title": "Mods",
    "unsupported": { "title": "Les mods ne sont pas gérés pour ce serveur", "description": "Le conteneur Minecraft doit être un serveur moddé ou à plugins (TYPE=FABRIC, QUILT, FORGE, NEOFORGE, PAPER, ...). Un serveur vanilla n'a pas de dossier de mods." },
    "source": {
      "inline": { "title": "La liste des mods est encore dans votre compose", "description": "Importez-la une fois, puis faites pointer MODRINTH_PROJECTS vers le fichier géré par MC Manager pour que vos changements s'appliquent au prochain redémarrage." },
      "other": { "title": "MODRINTH_PROJECTS pointe vers un autre fichier de liste", "description": "MC Manager ne gère que son propre fichier. Faites pointer la variable dessus pour que vos changements s'appliquent au prochain redémarrage." },
      "none": { "title": "MODRINTH_PROJECTS n'est pas défini sur le conteneur", "description": "Ajoutez cette ligne à l'environnement du conteneur Minecraft pour que la liste ci-dessous soit appliquée au prochain redémarrage." }
    },
    "composeLine": "Ligne à ajouter à l'environnement du conteneur",
    "copy": "Copier", "copied": "Copié",
    "import": "Importer {{count}} mod(s)", "imported": "Liste des mods importée",
    "restartRequired": "Redémarrage requis : le serveur ne charge les mods qu'au démarrage.",
    "modrinth": { "title": "Mods Modrinth", "empty": "Aucun mod Modrinth pour l'instant.", "installed": "Installé", "absent": "Non installé", "pending": "En attente du redémarrage", "unmanaged": "Lignes conservées telles quelles", "invalidLine": "Ligne non reconnue" },
    "add": { "placeholder": "Slug du projet, ex. lithium ou lithium:0.14.0", "button": "Ajouter", "hint": "Le slug est la fin de l'URL du projet sur modrinth.com." },
    "added": "Mod ajouté", "removed": "Mod retiré",
    "remove": { "button": "Retirer", "title": "Retirer {{entry}} de la liste ?", "description": "L'image supprimera son jar au prochain redémarrage. Vous pourrez le rajouter plus tard." },
    "enable": "Activer", "disable": "Désactiver",
    "manual": { "title": "Jars manuels", "description": "Fichiers déposés à la main dans le dossier des mods ; les désactivés sont renommés en .jar.disabled.", "empty": "Aucun jar déposé à la main.", "conflict": ".jar et .jar.disabled existent tous les deux : supprimez l'un des deux sur l'hôte." },
    "errors": {
      "invalid_entry": "Entrée invalide : un slug Modrinth, éventuellement suivi de :version, précédé d'un loader ou suivi de ?.",
      "duplicate": "Ce projet est déjà dans la liste.",
      "unknown_project": "Aucun projet Modrinth avec ce slug.",
      "wrong_type": "Ce projet Modrinth n'est pas un mod (modpack, pack de ressources ou shader).",
      "loader_mismatch": "Ce projet n'a pas de version pour le loader du serveur.",
      "modrinth_unavailable": "Modrinth est injoignable. Réessayez plus tard.",
      "unsupported_server": "Les mods ne sont pas gérés pour ce type de serveur.",
      "busy": "Une autre opération sur les données est en cours (sauvegarde, restauration ou configuration). Réessayez dans un instant.",
      "conflict": "État incohérent sur le disque : vérifiez le dossier des mods sur l'hôte.",
      "not_found": "Ce mod n'est plus dans la liste."
    }
  }
} }
```

Dans `nav.json`, ajouter `"mods": "Mods"` dans `en` et `fr`. Dans `audit.json`, ajouter `"mods": "Mods"` dans `actions` pour `en` et `fr`.

Run: `node packages/frontend/scripts/merge-i18n.mjs`
Expected: `merged: mods (...)`, parité des clés OK.

- [ ] **Step 3 : déplacer `RestartBanner` et l'étendre**

```bash
git mv packages/frontend/src/components/config/RestartBanner.tsx packages/frontend/src/components/shared/RestartBanner.tsx
```

Dans `pages/Config.tsx`, remplacer l'import par `import { RestartBanner } from '@/components/shared/RestartBanner';`. Dans `RestartBanner.tsx`, accepter un libellé optionnel et invalider `mods` :

```tsx
export function RestartBanner({ message }: { message?: string } = {}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const restart = useMutation({ mutationFn: () => serverApi.restart(), onSuccess: () => {
    toast.success(t('config.restarting')); setOpen(false);
    for (const key of ['config', 'server', 'mods']) void qc.invalidateQueries({ queryKey: [key] });
  }, onError: (e: { response?: { data?: { error?: string } } }) => { toast.error(e.response?.data?.error ?? t('shared.error')); setOpen(false); } });
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <RefreshCw className="h-4 w-4 text-amber-500" />
      <span>{message ?? t('config.restartRequired')}</span>
      <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>{t('config.restartNow')}</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={t('config.restartTitle')} description={t('config.restartDescription')} destructive loading={restart.isPending} onConfirm={() => restart.mutate()} />
    </div>
  );
}
```

- [ ] **Step 4 : WebSocket, navigation, route, filtre d'audit**

`hooks/use-websocket.ts` : dans `onopen`, ajouter `void queryClient.invalidateQueries({ queryKey: ['mods'] });` ; dans `onmessage`, ajouter `if (msg.type === 'mods.changed') void queryClient.invalidateQueries({ queryKey: ['mods'] });`.

Ajouter dans `hooks/use-websocket.test.ts`, dans le `describe('useWebSocket')` existant (il fournit déjà `FakeSocket`, `wrapper`, `queryClient` et le `beforeEach` qui stubbe `WebSocket`) :

```ts
  it('invalidates the mods query on mods.changed and on open', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    act(() => ws.onopen?.());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mods'] });
    invalidate.mockClear();
    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'mods.changed' }) }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['mods'] });
    expect(useServerStore.getState().info).toBeNull(); // le store ignore ce message
  });
```

`components/layout/Sidebar.tsx` : importer `Puzzle` de `lucide-react` et insérer `{ to: '/mods', icon: Puzzle, label: 'nav.mods' }` entre l'entrée `/players` et l'entrée `/config` (visible par tous).

`App.tsx` : importer `Mods` depuis `./pages/Mods` et ajouter `<Route path="/mods" element={<Mods />} />` après la route `/players/:uuid`. Créer provisoirement `packages/frontend/src/pages/Mods.tsx` :

```tsx
export default function Mods() { return null; }
```

`pages/Audit.tsx` : `const ACTIONS = ['', 'server', 'rcon', 'backup', 'user', 'player', 'whitelist', 'journal', 'mods'];`

- [ ] **Step 5 : tests, typecheck, lint**

Run: `pnpm --filter @mc/frontend exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS (les tests de Config passent toujours avec le bandeau déplacé).

- [ ] **Step 6 : commit**

```bash
git add packages/frontend/src packages/frontend/scripts
git commit -m "feat(lot3): client API mods, invalidation WebSocket, navigation, bandeau de redémarrage partagé, i18n

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10 : page Mods et composants

**Files:**
- Modify: `packages/frontend/src/pages/Mods.tsx` (remplace le placeholder)
- Create: `packages/frontend/src/components/mods/mods-errors.ts`
- Create: `packages/frontend/src/components/mods/SourceBanner.tsx`
- Create: `packages/frontend/src/components/mods/AddModForm.tsx`
- Create: `packages/frontend/src/components/mods/ModrinthList.tsx`
- Create: `packages/frontend/src/components/mods/ManualList.tsx`
- Test: `packages/frontend/src/pages/Mods.test.tsx`

**Interfaces:**
- Consumes: `modsApi` (tâche 9), `RestartBanner` partagé, `ConfirmDialog`, `EmptyState`, `PageLoader`, `Switch`, `Badge`, `Button`, `Input`, `Card`, `formatBytes` (`@/lib/utils`), clés i18n `mods.*`.

- [ ] **Step 1 : écrire les tests de page**

`packages/frontend/src/pages/Mods.test.tsx` :

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { modsApi } from '@/api/mods.api';
import Mods from './Mods';
import { toast } from 'sonner';
import type { ModsView } from '@mc/common';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/mods.api', () => ({ modsApi: { get: vi.fn(), import: vi.fn(), add: vi.fn(), toggle: vi.fn(), remove: vi.fn(), toggleFile: vi.fn() } }));
vi.mock('@/api/server.api', () => ({ serverApi: { restart: vi.fn().mockResolvedValue({}) } }));

const base: ModsView = {
  server: { loader: 'fabric', dir: 'mods' }, source: 'file', inlineEntries: [], listingExists: true,
  composeLine: 'MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"', restartRequired: false,
  modrinth: [
    { entry: 'fabric-api', slug: 'fabric-api', enabled: true, installed: true, title: 'Fabric API', iconUrl: null, projectId: 'P7dR8mSH' },
    { entry: 'lithium:0.14.0', slug: 'lithium', enabled: false, installed: true, title: null, iconUrl: null, projectId: null },
    { entry: 'spark', slug: 'spark', enabled: false, installed: false, title: null, iconUrl: null, projectId: null },
  ],
  unmanagedLines: [{ raw: 'bad entry', invalid: true }],
  manual: [{ file: 'custom.jar', enabled: true, size: 2048, mtime: '2026-10-11T10:00:00Z', conflict: false }],
};

function setup(role: 'admin' | 'viewer' = 'admin', view: ModsView = base) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(modsApi.get).mockResolvedValue(view);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><Mods /></MemoryRouter></QueryClientProvider>);
}

describe('Mods page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists Modrinth and manual mods with their state', async () => {
    setup();
    expect(await screen.findByText('Fabric API')).toBeInTheDocument();
    expect(screen.getByText('lithium:0.14.0')).toBeInTheDocument();
    expect(screen.getByText('Installed')).toBeInTheDocument();      // fabric-api : actif et installé
    expect(screen.getByText('Pending restart')).toBeInTheDocument(); // lithium : désactivé mais encore installé
    expect(screen.getByText('Not installed')).toBeInTheDocument();   // spark : désactivé et absent
    expect(screen.getByText('bad entry')).toBeInTheDocument();
    expect(screen.getByText('custom.jar')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.queryByText(/Restart required/)).not.toBeInTheDocument();
  });

  it('toggles a Modrinth mod and a manual jar, replacing the view', async () => {
    setup();
    vi.mocked(modsApi.toggle).mockResolvedValue({ ...base, restartRequired: true });
    vi.mocked(modsApi.toggleFile).mockResolvedValue({ ...base, restartRequired: true });
    await screen.findByText('Fabric API');
    fireEvent.click(screen.getByRole('switch', { name: 'lithium:0.14.0' }));
    await waitFor(() => expect(modsApi.toggle).toHaveBeenCalledWith('lithium:0.14.0', true));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'custom.jar' }));
    await waitFor(() => expect(modsApi.toggleFile).toHaveBeenCalledWith('custom.jar', false));
  });

  it('adds a mod and shows the translated error code on failure', async () => {
    setup();
    await screen.findByText('Fabric API');
    const input = screen.getByPlaceholderText(/Project slug/);
    vi.mocked(modsApi.add).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'loader_mismatch' } } });
    fireEvent.change(input, { target: { value: 'plugin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This project has no version for the server loader.'));
    vi.mocked(modsApi.add).mockResolvedValueOnce(base);
    fireEvent.change(input, { target: { value: 'spark' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(modsApi.add).toHaveBeenCalledWith('spark'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod added'));
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('removes a mod after confirmation', async () => {
    setup();
    vi.mocked(modsApi.remove).mockResolvedValue({ ...base, modrinth: [base.modrinth[1]] });
    await screen.findByText('Fabric API');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(await screen.findByText('Remove fabric-api from the list?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.remove).toHaveBeenCalledWith('fabric-api'));
    await waitFor(() => expect(screen.queryByText('Fabric API')).not.toBeInTheDocument());
  });

  it('offers the import when the list is inline, with the compose line', async () => {
    setup('admin', { ...base, source: 'inline', inlineEntries: ['fabric-api', 'lithium'], listingExists: false, modrinth: [] });
    vi.mocked(modsApi.import).mockResolvedValue({ ...base, source: 'inline', inlineEntries: ['fabric-api', 'lithium'] });
    expect(await screen.findByText('The mod list still lives in your compose file')).toBeInTheDocument();
    expect(screen.getByText(base.composeLine)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 mod(s)' }));
    await waitFor(() => expect(modsApi.import).toHaveBeenCalled());
    expect(await screen.findByText('Fabric API')).toBeInTheDocument();
  });

  it('is read-only for viewers and on unsupported servers', async () => {
    setup('viewer');
    await screen.findByText('Fabric API');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('explains unsupported servers', async () => {
    setup('admin', { ...base, server: null, source: 'none', modrinth: [], manual: [] });
    expect(await screen.findByText('Mods are not managed for this server')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Project slug/)).not.toBeInTheDocument();
  });
});
```

Le bouton de confirmation de `ConfirmDialog` s'appelle « Confirm » en anglais (`shared.confirm`) et `formatBytes(2048)` rend `2 KB` : les assertions ci-dessus s'appuient dessus.

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Mods.test.tsx`
Expected: FAIL (page vide).

- [ ] **Step 3 : écrire l'utilitaire d'erreurs**

`packages/frontend/src/components/mods/mods-errors.ts` :

```ts
import type { TFunction } from 'i18next';

export type ApiError = { response?: { data?: { error?: string; code?: string } } };

const CODES = new Set(['invalid_entry', 'duplicate', 'unknown_project', 'wrong_type', 'loader_mismatch', 'modrinth_unavailable', 'unsupported_server', 'busy', 'conflict', 'not_found']);

/** Message traduit par code quand le backend en fournit un, sinon son message brut, sinon l'erreur générique. */
export function describeModsError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  if (code && CODES.has(code)) return t(`mods.errors.${code}`);
  return e.response?.data?.error ?? t('shared.error');
}
```

- [ ] **Step 4 : écrire les composants**

`components/mods/SourceBanner.tsx` :

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Copy, Check } from 'lucide-react';
import type { ModsView } from '@mc/common';
import { Button } from '@/components/ui/button';

export function SourceBanner({ view, canAct, onImport, importing }: { view: ModsView; canAct: boolean; onImport: () => void; importing: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (view.source === 'file') return null;
  const copy = () => { void navigator.clipboard?.writeText(view.composeLine).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <p className="font-medium">{t(`mods.source.${view.source}.title`)}</p>
          <p className="text-muted-foreground">{t(`mods.source.${view.source}.description`)}</p>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">{t('mods.composeLine')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono-data text-xs">{view.composeLine}</code>
          <Button size="sm" variant="outline" onClick={copy} aria-label={t('mods.copy')}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        </div>
      </div>
      {canAct && view.source === 'inline' && !view.listingExists && (
        <Button size="sm" disabled={importing} onClick={onImport}>{t('mods.import', { count: view.inlineEntries.length })}</Button>
      )}
    </div>
  );
}
```

`components/mods/AddModForm.tsx` :

```tsx
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AddModForm({ onAdd, pending }: { onAdd: (entry: string, reset: () => void) => void; pending: boolean }) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const v = entry.trim(); if (v) onAdd(v, () => setEntry('')); };
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <Input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={t('mods.add.placeholder')} className="font-mono-data" disabled={pending} />
        <Button type="submit" size="sm" disabled={pending || !entry.trim()}><Plus className="mr-1 h-3.5 w-3.5" />{t('mods.add.button')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('mods.add.hint')}</p>
    </form>
  );
}
```

`components/mods/ModrinthList.tsx` :

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Trash2 } from 'lucide-react';
import type { ModrinthMod, ModsView } from '@mc/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { AddModForm } from './AddModForm';

interface Props {
  view: ModsView; canAct: boolean; pending: boolean;
  onAdd: (entry: string, reset: () => void) => void;
  onToggle: (entry: string, enabled: boolean) => void;
  onRemove: (entry: string) => void;
}

export function ModrinthList({ view, canAct, pending, onAdd, onToggle, onRemove }: Props) {
  const { t } = useTranslation();
  const [toRemove, setToRemove] = useState<ModrinthMod | null>(null);
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">{t('mods.modrinth.title')}</CardTitle>
        {canAct && <AddModForm onAdd={onAdd} pending={pending} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {view.modrinth.length === 0 && <p className="text-sm text-muted-foreground">{t('mods.modrinth.empty')}</p>}
        {view.modrinth.map((m) => (
          <div key={m.entry} className="flex items-center gap-3 rounded-md border border-border p-2">
            {m.iconUrl ? <img src={m.iconUrl} alt="" className="h-8 w-8 rounded" /> : <div className="flex h-8 w-8 items-center justify-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></div>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.title ?? m.slug}</p>
              <p className="truncate font-mono-data text-xs text-muted-foreground">{m.entry}</p>
            </div>
            <Badge variant={m.installed !== m.enabled ? 'warning' : m.installed ? 'success' : 'secondary'}>
              {m.installed !== m.enabled ? t('mods.modrinth.pending') : m.installed ? t('mods.modrinth.installed') : t('mods.modrinth.absent')}
            </Badge>
            {canAct && (
              <>
                <Switch aria-label={m.entry} checked={m.enabled} disabled={pending} onCheckedChange={(on) => onToggle(m.entry, on)} />
                <Button size="sm" variant="ghost" aria-label={t('mods.remove.button')} disabled={pending} onClick={() => setToRemove(m)}><Trash2 className="h-4 w-4" /></Button>
              </>
            )}
          </div>
        ))}
        {view.unmanagedLines.length > 0 && (
          <div className="pt-2">
            <p className="mb-1 text-xs text-muted-foreground">{t('mods.modrinth.unmanaged')}</p>
            {view.unmanagedLines.map((l, i) => (
              <p key={i} className="font-mono-data text-xs text-muted-foreground" title={l.invalid ? t('mods.modrinth.invalidLine') : undefined}>{l.invalid ? '⚠ ' : ''}{l.raw}</p>
            ))}
          </div>
        )}
      </CardContent>
      <ConfirmDialog open={toRemove !== null} onOpenChange={(o) => { if (!o) setToRemove(null); }} title={t('mods.remove.title', { entry: toRemove?.entry ?? '' })} description={t('mods.remove.description')} destructive loading={pending} onConfirm={() => { if (toRemove) onRemove(toRemove.entry); setToRemove(null); }} />
    </Card>
  );
}
```

Trois états de badge : état voulu ≠ état du manifeste → « En attente du redémarrage » (ambre) ; actif et installé → « Installé » (vert) ; désactivé et absent → « Non installé » (neutre).

`components/mods/ManualList.tsx` :

```tsx
import { useTranslation } from 'react-i18next';
import { FileArchive } from 'lucide-react';
import type { ManualMod } from '@mc/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/lib/utils';

export function ManualList({ mods, canAct, pending, onToggle }: { mods: ManualMod[]; canAct: boolean; pending: boolean; onToggle: (file: string, enabled: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mods.manual.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('mods.manual.description')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {mods.length === 0 && <p className="text-sm text-muted-foreground">{t('mods.manual.empty')}</p>}
        {mods.map((m) => (
          <div key={m.file} className="flex items-center gap-3 rounded-md border border-border p-2">
            <FileArchive className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono-data text-sm">{m.file}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(m.size)}</p>
            </div>
            {m.conflict && <Badge variant="destructive" title={t('mods.manual.conflict')}>{t('mods.manual.conflict')}</Badge>}
            {canAct && <Switch aria-label={m.file} checked={m.enabled} disabled={pending || m.conflict} onCheckedChange={(on) => onToggle(m.file, on)} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

`pages/Mods.tsx` :

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ModsView } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { RestartBanner } from '@/components/shared/RestartBanner';
import { SourceBanner } from '@/components/mods/SourceBanner';
import { ModrinthList } from '@/components/mods/ModrinthList';
import { ManualList } from '@/components/mods/ManualList';
import { describeModsError, type ApiError } from '@/components/mods/mods-errors';

export default function Mods() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['mods'], queryFn: modsApi.get });
  const onError = (e: ApiError) => toast.error(describeModsError(e, t));
  const replace = (view: ModsView) => qc.setQueryData(['mods'], view);
  const importMut = useMutation({ mutationFn: modsApi.import, onSuccess: (v) => { replace(v); toast.success(t('mods.imported')); }, onError });
  const add = useMutation({ mutationFn: (entry: string) => modsApi.add(entry), onSuccess: (v) => { replace(v); toast.success(t('mods.added')); }, onError });
  const toggle = useMutation({ mutationFn: ({ entry, enabled }: { entry: string; enabled: boolean }) => modsApi.toggle(entry, enabled), onSuccess: replace, onError });
  const remove = useMutation({ mutationFn: (entry: string) => modsApi.remove(entry), onSuccess: (v) => { replace(v); toast.success(t('mods.removed')); }, onError });
  const toggleFile = useMutation({ mutationFn: ({ file, enabled }: { file: string; enabled: boolean }) => modsApi.toggleFile(file, enabled), onSuccess: replace, onError });
  if (isLoading || !data) return <PageLoader />;
  const pending = importMut.isPending || add.isPending || toggle.isPending || remove.isPending || toggleFile.isPending;
  const canAct = isAdmin && data.server !== null;
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('mods.title')}</h1>
      {data.server === null ? (
        <EmptyState title={t('mods.unsupported.title')} description={t('mods.unsupported.description')} />
      ) : (
        <>
          <SourceBanner view={data} canAct={isAdmin} onImport={() => importMut.mutate()} importing={importMut.isPending} />
          {data.restartRequired && <RestartBanner message={t('mods.restartRequired')} />}
          <ModrinthList view={data} canAct={canAct} pending={pending}
            onAdd={(entry, reset) => add.mutate(entry, { onSuccess: reset })}
            onToggle={(entry, enabled) => toggle.mutate({ entry, enabled })}
            onRemove={(entry) => remove.mutate(entry)} />
          <ManualList mods={data.manual} canAct={canAct} pending={pending} onToggle={(file, enabled) => toggleFile.mutate({ file, enabled })} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Mods.test.tsx && pnpm --filter @mc/frontend exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6 : vérification visuelle**

Run: `pnpm dev`, ouvrir `http://localhost:5173/mods` en admin, puis en viewer. Vérifier : bandeau de source (sans conteneur Fabric local, la page affiche l'état « non supporté » ; pour voir le reste, lancer un conteneur `itzg/minecraft-server` avec `TYPE=FABRIC` ou simuler avec un `MC_CONTAINER` existant), largeur mobile sans débordement horizontal, mode sombre.

- [ ] **Step 7 : commit**

```bash
git add packages/frontend/src/pages/Mods.tsx packages/frontend/src/pages/Mods.test.tsx packages/frontend/src/components/mods
git commit -m "feat(lot3): page Mods, listes Modrinth et manuelle, ajout, activation et retrait

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11 : documentation, compose d'exemple, CLAUDE.md

**Files:**
- Modify: `README.md` (nouvelle section « Mods » après « Server configuration », paragraphe dans « Privacy », ligne dans « Roadmap » si le lot y est listé)
- Modify: `docker-compose.example.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1 : README**

Après la section `## Server configuration`, ajouter :

````markdown
## Mods

The Mods page lists the mods (or plugins) of a modded server and lets an admin enable, disable, add or remove them. Nothing is loaded at runtime: every change applies at the next restart, and the page says so.

- **Modrinth mods** are the entries of `MODRINTH_PROJECTS`. MC Manager owns a listing file in the data volume, `/data/mc-manager/modrinth-projects.txt`, in the native itzg format (one entry per line, `#` comments). Point the variable to it in the Minecraft stack:

  ```yaml
  environment:
    TYPE: FABRIC
    MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"
  ```

  If the variable still holds an inline list, the page offers to import it once. Disabling a mod comments its line; the image removes its jar at the next start and downloads it again when re-enabled. Adding a mod takes a Modrinth slug (optionally `slug:version`, a `fabric:`/`paper:`/`datapack:` prefix or a trailing `?` for optional), verified against the Modrinth API before it is written.
- **Manual jars** dropped by hand in `mods/` (or `plugins/`) that the image does not manage are toggled by renaming them to `.jar.disabled`. Nothing is ever deleted.
- Supported server types: `FABRIC`, `QUILT`, `FORGE`, `NEOFORGE` (folder `mods/`) and `PAPER`, `SPIGOT`, `BUKKIT`, `PURPUR`, `FOLIA` (folder `plugins/`). On a vanilla server the page is read-only.
- All writes are admin-only, audited, and serialized with backups, restores and `server.properties` edits.
````

Dans `## Privacy`, remplacer « There is no other external call. » par :

```markdown
The Mods page is the only other source of external calls: when an admin adds a mod, and once per unknown entry of the listing file, the backend queries `api.modrinth.com` to verify the project and cache its title and icon; the browser then loads mod icons from `cdn.modrinth.com`. Nothing is sent to Modrinth beyond the project slug.
```

- [ ] **Step 2 : compose d'exemple**

Dans `docker-compose.example.yml`, sous `TYPE: "PAPER"`, ajouter en commentaire :

```yaml
      # Modded server managed from the Mods page (see README, "Mods"):
      # TYPE: "FABRIC"
      # MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"
```

Run: `docker compose -f docker-compose.example.yml config > /dev/null`
Expected: aucune erreur.

- [ ] **Step 3 : CLAUDE.md**

Dans « Vue d'ensemble », remplacer « Les lots 1, 2a et 2b sont implémentés. » par « Les lots 1, 2a, 2b et 3 (mods) sont implémentés ; specs dans `docs/superpowers/specs/`. »

Dans « Architecture backend », après le point `server.properties`, ajouter :

```markdown
- **Mods (lot 3)** : `mods/mods-service.ts` agrège le fichier de liste itzg `<dataDir>/mc-manager/modrinth-projects.txt` (`listing-file.ts` : ligne désactivée = `# <entrée>`, lignes non reconnues conservées telles quelles), le manifeste `.modrinth-manifest.json` écrit par l'image (`manifest.ts` : `files`, `projects`), le dossier `mods/` ou `plugins/` selon `TYPE` (`server-type.ts`) et le cache `ModrinthProject`. `restartRequired` = entrées actives ≠ `projects` du manifeste (par slug) ou renommage manuel depuis `StartedAt` (horodatage en mémoire). Ajout validé par `api.modrinth.com` (`modrinth-client.ts`, `ModrinthLike`, `FakeModrinth` en test) hors verrou, puis écriture sous `DataLock('mods')`. Les jars manuels (absents de `files`) sont renommés `.jar.disabled`, jamais supprimés. Routes `/api/mods` (lecture pour tous, écritures admin auditées `mods.*`), message `mods.changed`. `AppError` porte un `code` stable traduit par le frontend.
```

Dans « Architecture frontend », ajouter : « Page `/mods` (`pages/Mods.tsx`, composants `components/mods/`) : query `mods` invalidée sur `mods.changed` ; `RestartBanner` est partagé (`components/shared/`). »

Dans « Invariants de sécurité », compléter le point sur le volume de données : « … les seules écritures sont la restauration, `server.properties` et les mods (fichier `mc-manager/modrinth-projects.txt` et renommages `.jar` ⇄ `.jar.disabled` dans `mods/`, jamais de suppression), admin, auditées, sous `DataLock` … » et ajouter le point : « Appels sortants du backend : `api.modrinth.com` uniquement (ajout de mod, résolution de métadonnées), documenté dans la section Privacy du README. »

- [ ] **Step 4 : chaîne CI complète**

Run: `pnpm db:generate && pnpm --filter @mc/common run build && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tout passe.

- [ ] **Step 5 : commit**

```bash
git add README.md docker-compose.example.yml CLAUDE.md
git commit -m "docs(lot3): README, compose d'exemple et CLAUDE.md pour la gestion des mods

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
