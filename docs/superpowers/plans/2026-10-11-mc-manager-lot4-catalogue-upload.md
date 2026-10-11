# Lot 4 : catalogue Modrinth et dépôt de jars, plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis la page Mods, chercher un mod dans le catalogue Modrinth et l'ajouter en un clic, déposer un fichier `.jar` vérifié dans le dossier des mods, et supprimer un jar manuel.

**Architecture:** Le backend relaie la recherche Modrinth (`/v2/search`, facettes loader + version, cache 60 s) et expose `GET /api/mods/search`. L'upload est un `POST` en flux brut streamé vers `mc-manager/tmp/<uuid>.part`, inspecté par `yauzl` (descripteur du loader, métadonnées), puis déplacé atomiquement dans `mods/` sous `DataLock`. La suppression ne concerne que les jars manuels. nginx porte la limite de corps à 100 Mo sur la seule route d'upload.

**Tech Stack:** Express + `yauzl` (seule dépendance ajoutée), `fetch` natif, vitest + supertest ; React 18, TanStack Query, axios (`onUploadProgress`, `AbortController`), sonner, shadcn, i18next.

**Spec:** `docs/superpowers/specs/2026-10-11-mc-manager-lot4-catalogue-upload-design.md` (s'appuie sur la spec du lot 3, `2026-10-11-mc-manager-lot3-mods-design.md`, section 8 incluse).

## Global Constraints

- Node 20+ (CI et Docker en 22), pnpm 9. `pnpm db:generate` après tout changement de `schema.prisma` (aucun ici), `pnpm --filter @mc/common run build` après tout changement de `packages/common`.
- Avant chaque commit : `pnpm lint`, `pnpm typecheck`, tests du package touché. Avant de pousser : `db:generate`, build common, lint, typecheck, test, build.
- Écritures dans `/data` autorisées : fichier de liste, renommages dans `mods/` ou `plugins/`, dépôt d'un jar vérifié dans ce dossier via `mc-manager/tmp/`, suppression d'un jar manuel. Jamais de suppression d'un jar présent dans `files` du manifeste, jamais d'extraction du contenu d'un jar sur le disque, jamais de chemin dérivé du contenu d'une archive.
- Nom de fichier déposé : `^[A-Za-z0-9._+ ()\[\]-]{1,96}\.jar$`, sans `..`, `path.basename(name) === name`, validé par la route ET par le service.
- Taille maximale d'upload : `100 * 1024 * 1024` octets, appliquée par nginx (`client_max_body_size 100m` sur `location = /api/mods/upload`) puis par le backend (`Content-Length` et compteur de flux).
- Tout `.part` est supprimé en cas d'erreur ; les orphelins sont purgés au démarrage.
- Recherche : requête nettoyée (`trim`, 100 caractères max), 2 caractères minimum, 20 résultats, cache mémoire 60 s / 50 entrées par `(q, loader, version)`.
- Codes d'erreur ajoutés : `invalid_query`, `invalid_name`, `too_large`, `upload_aborted`, `not_a_jar`, `wrong_loader`, `exists`, `managed`, `duplicate_mod`. Actions d'audit ajoutées : `mods.upload`, `mods.file.delete`.
- i18n : fragment `packages/frontend/scripts/i18n-fragments/mods.json` puis `node packages/frontend/scripts/merge-i18n.mjs` ; jamais d'édition directe des locales.
- Commits en français, type conventionnel, terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

- **`Content-Length` mensonger** (déclare 10 octets, envoie 200 Mo) : le compteur de flux coupe à 100 Mo, 413 `too_large`, aucun `.part` restant (test « stops a body that exceeds the limit regardless of Content-Length » dans la tâche 5).
- **Nom identique à un jar géré par Modrinth**, même avec `replace=1` : 409 `managed`, le fichier géré n'est pas touché (test « refuses to overwrite a Modrinth-managed jar even with replace » dans la tâche 5).
- **Descripteur énorme ou archive piégée** (`fabric.mod.json` de 5 Mo) : lecture arrêtée à 1 Mo, `meta: null`, pas de plantage ni de mémoire explosée (test « caps descriptor reading at 1 MiB » dans la tâche 2).
- **Requête de recherche hostile** (200 caractères, `&`, `#`, espaces) : tronquée à 100, encodée dans l'URL, facettes intactes (test « encodes the query and facets » dans la tâche 3).
- **Upload pendant une restauration** : la réception se fait sans verrou, le 409 `busy` arrive au déplacement final et le `.part` est supprimé (test « leaves no temp file when the data lock is busy » dans la tâche 5).

---

### Task 1 : types communs, codes d'erreur, actions d'audit, dépendance `yauzl`

**Files:**
- Modify: `packages/common/src/types/mods.ts`
- Modify: `packages/common/src/types/audit.ts`
- Modify: `packages/backend/package.json` (via `pnpm add`)
- Modify: `packages/backend/src/mods/listing-file.ts` (utilise la regex partagée)
- Test: `packages/backend/src/mods/listing-file.test.ts` (existant, doit rester vert)

**Interfaces:**
- Produces: `MODRINTH_ENTRY_RE`, `JarMeta`, `ManualMod.meta`, `ModrinthSearchHit`, `ModsSearchResult`, `ModsErrorCode` étendu, `AuditAction` étendu ; `yauzl` + `@types/yauzl` installés.

- [ ] **Step 1 : étendre les types communs**

Dans `packages/common/src/types/mods.ts`, ajouter en tête :

```ts
/** Grammaire d'une entrée MODRINTH_PROJECTS (partagée backend/frontend) : préfixe loader, projet, version, `?` optionnel. */
export const MODRINTH_ENTRY_RE = /^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$/i;
/** Taille maximale d'un jar déposé depuis la WebUI (nginx et backend appliquent la même limite). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
```

Remplacer la définition de `ModsErrorCode` par :

```ts
export type ModsErrorCode =
  | 'invalid_entry' | 'duplicate' | 'unknown_project' | 'wrong_type' | 'loader_mismatch'
  | 'modrinth_unavailable' | 'unsupported_server' | 'busy' | 'conflict' | 'not_found'
  | 'invalid_query' | 'invalid_name' | 'too_large' | 'upload_aborted' | 'not_a_jar' | 'wrong_loader'
  | 'exists' | 'managed' | 'duplicate_mod';
```

Ajouter avant `ManualMod` :

```ts
/** Métadonnées lues dans le descripteur du jar (fabric.mod.json, mods.toml, plugin.yml). */
export interface JarMeta { id: string | null; name: string | null; version: string | null }
```

et dans `ManualMod`, après `conflict` :

```ts
  /** null si le jar n'a pas de descripteur lisible. */
  meta: JarMeta | null;
```

Ajouter à la fin du fichier :

```ts
/** Un résultat de recherche Modrinth, relayé par le backend. */
export interface ModrinthSearchHit {
  slug: string;
  projectId: string;
  title: string;
  description: string | null;
  iconUrl: string | null;
  author: string | null;
  downloads: number;
  follows: number;
  latestVersion: string | null;
  /** Déjà dans le fichier de liste (actif ou désactivé). */
  alreadyListed: boolean;
}

export interface ModsSearchResult {
  loader: string;
  /** Version Minecraft utilisée comme filtre ; null = inconnue, filtre sur le loader seul. */
  gameVersion: string | null;
  hits: ModrinthSearchHit[];
}
```

Dans `packages/common/src/types/audit.ts`, étendre `AuditAction` :

```ts
  | 'mods.import' | 'mods.add' | 'mods.toggle' | 'mods.remove' | 'mods.file.toggle'
  | 'mods.upload' | 'mods.file.delete';
```

- [ ] **Step 2 : partager la grammaire avec le backend**

Dans `packages/backend/src/mods/listing-file.ts`, remplacer

```ts
export const ENTRY_RE = /^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$/i;
```

par

```ts
import { MODRINTH_ENTRY_RE } from '@mc/common';
export const ENTRY_RE = MODRINTH_ENTRY_RE;
```

(l'import se place en tête de fichier, avec les autres).

- [ ] **Step 3 : installer yauzl**

Run: `pnpm --filter @mc/backend add yauzl@^3.2.0 && pnpm --filter @mc/backend add -D @types/yauzl@^2.10.3`
Expected: les deux lignes apparaissent dans `packages/backend/package.json`, `pnpm-lock.yaml` mis à jour. Puis `pnpm audit --audit-level high` : aucun avis nouveau (yauzl n'a pas de dépendance autre que `buffer-crc32` et `pend`).

- [ ] **Step 4 : construire common, vérifier types et tests existants**

Run: `pnpm --filter @mc/common run build && pnpm typecheck && pnpm --filter @mc/backend exec vitest run src/mods/listing-file.test.ts`
Expected: typecheck vert sur les trois packages, 7 tests verts.

- [ ] **Step 5 : commit**

```bash
git add packages/common/src packages/backend/package.json packages/backend/src/mods/listing-file.ts pnpm-lock.yaml
git commit -m "feat(lot4): types du catalogue et de l'upload, grammaire partagée, dépendance yauzl

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : écrivain zip de test et inspecteur de jar

**Files:**
- Create: `packages/backend/src/mods/test-zip.ts` (utilitaire de test, non importé par le code de production)
- Create: `packages/backend/src/mods/jar-inspector.ts`
- Test: `packages/backend/src/mods/jar-inspector.test.ts`

**Interfaces:**
- Produces: `writeZip(file: string, entries: Record<string, string | Buffer>): Promise<void>` (test), `type JarLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'paper'`, `interface JarInfo { found: { loader: JarLoader; meta: JarMeta | null }[] }`, `class JarError extends Error { code: 'not_a_jar' }`, `inspectJar(file: string): Promise<JarInfo>`, `pickLoader(info: JarInfo, dir: ModsDir, serverLoader: string): { loader: JarLoader; meta: JarMeta | null } | null`, `DESCRIPTOR_LIMIT = 1 MiB`.

- [ ] **Step 1 : écrire l'écrivain zip de test**

`packages/backend/src/mods/test-zip.ts` :

```ts
import { writeFile } from 'fs/promises';

/** CRC-32 (IEEE) sans dépendance : zlib.crc32 n'existe qu'à partir de Node 22.2. */
const TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Écrit une archive zip minimale (entrées « stored », sans compression) : assez pour yauzl et pour un vrai jar. */
export async function writeZip(file: string, entries: Record<string, string | Buffer>): Promise<void> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(entries).length, 8); eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  await writeFile(file, Buffer.concat([...locals, cd, eocd]));
}
```

- [ ] **Step 2 : écrire les tests de l'inspecteur**

`packages/backend/src/mods/jar-inspector.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { writeZip } from './test-zip.js';
import { inspectJar, pickLoader, JarError } from './jar-inspector.js';

async function jar(entries: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mc-jar-'));
  const file = path.join(dir, 'mod.jar');
  await writeZip(file, entries);
  return file;
}

describe('inspectJar', () => {
  it('reads a Fabric descriptor', async () => {
    const f = await jar({ 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n', 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'lithium', name: 'Lithium', version: '0.14.0' }), 'me/x/A.class': Buffer.alloc(3) });
    expect(await inspectJar(f)).toEqual({ found: [{ loader: 'fabric', meta: { id: 'lithium', name: 'Lithium', version: '0.14.0' } }] });
  });
  it('reads a Quilt descriptor', async () => {
    const f = await jar({ 'quilt.mod.json': JSON.stringify({ quilt_loader: { id: 'qmod', version: '1.2' }, metadata: { name: 'QMod' } }) });
    expect((await inspectJar(f)).found).toEqual([{ loader: 'quilt', meta: { id: 'qmod', name: 'QMod', version: '1.2' } }]);
  });
  it('reads NeoForge and Forge TOML descriptors', async () => {
    const toml = 'modLoader="javafml"\n[[mods]]\nmodId="create"\nversion="6.0.1"\ndisplayName="Create"\n';
    expect((await inspectJar(await jar({ 'META-INF/neoforge.mods.toml': toml }))).found).toEqual([{ loader: 'neoforge', meta: { id: 'create', name: 'Create', version: '6.0.1' } }]);
    expect((await inspectJar(await jar({ 'META-INF/mods.toml': toml }))).found).toEqual([{ loader: 'forge', meta: { id: 'create', name: 'Create', version: '6.0.1' } }]);
  });
  it('reads Paper plugin descriptors, name doubling as id', async () => {
    expect((await inspectJar(await jar({ 'plugin.yml': "name: EssentialsX\nversion: '2.20.1'\nmain: x.Main\n" }))).found).toEqual([{ loader: 'paper', meta: { id: 'EssentialsX', name: 'EssentialsX', version: '2.20.1' } }]);
    expect((await inspectJar(await jar({ 'paper-plugin.yml': 'name: Chunky\nversion: 1.4.16\n' }))).found).toEqual([{ loader: 'paper', meta: { id: 'Chunky', name: 'Chunky', version: '1.4.16' } }]);
  });
  it('lists every descriptor of a multi-loader jar, in archive order', async () => {
    const f = await jar({ 'fabric.mod.json': JSON.stringify({ id: 'a', name: 'A', version: '1' }), 'META-INF/mods.toml': 'modId="a"\nversion="1"\ndisplayName="A"\n' });
    expect((await inspectJar(f)).found.map((x) => x.loader)).toEqual(['fabric', 'forge']);
  });
  it('returns no loader for a jar without descriptor and null meta for an unparsable one', async () => {
    expect((await inspectJar(await jar({ 'META-INF/MANIFEST.MF': 'x', 'a/B.class': 'y' }))).found).toEqual([]);
    expect((await inspectJar(await jar({ 'fabric.mod.json': '{not json' }))).found).toEqual([{ loader: 'fabric', meta: null }]);
  });
  it('caps descriptor reading at 1 MiB without failing', async () => {
    const huge = Buffer.alloc(5 * 1024 * 1024, 0x20);
    expect((await inspectJar(await jar({ 'fabric.mod.json': huge }))).found).toEqual([{ loader: 'fabric', meta: null }]);
  });
  it('throws JarError not_a_jar on a non-zip or truncated file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-jar-'));
    const f = path.join(dir, 'bad.jar');
    await writeFile(f, 'this is not a zip archive at all');
    await expect(inspectJar(f)).rejects.toMatchObject({ code: 'not_a_jar' });
    await expect(inspectJar(f)).rejects.toBeInstanceOf(JarError);
    await writeFile(f, Buffer.alloc(0));
    await expect(inspectJar(f)).rejects.toMatchObject({ code: 'not_a_jar' });
  });
});

describe('pickLoader', () => {
  const fab = { loader: 'fabric' as const, meta: null };
  const neo = { loader: 'neoforge' as const, meta: null };
  const paper = { loader: 'paper' as const, meta: null };
  it('accepts fabric and quilt jars on fabric/quilt servers, forge and neoforge on forge/neoforge, paper on plugin servers', () => {
    expect(pickLoader({ found: [fab] }, 'mods', 'fabric')).toEqual(fab);
    expect(pickLoader({ found: [{ loader: 'quilt', meta: null }] }, 'mods', 'fabric')?.loader).toBe('quilt');
    expect(pickLoader({ found: [neo] }, 'mods', 'forge')).toEqual(neo);
    expect(pickLoader({ found: [paper] }, 'plugins', 'purpur')).toEqual(paper);
  });
  it('prefers the descriptor matching the server family in a multi-loader jar', () => {
    expect(pickLoader({ found: [fab, neo] }, 'mods', 'neoforge')).toEqual(neo);
  });
  it('rejects a jar for another family or without descriptor', () => {
    expect(pickLoader({ found: [fab] }, 'mods', 'neoforge')).toBeNull();
    expect(pickLoader({ found: [paper] }, 'mods', 'fabric')).toBeNull();
    expect(pickLoader({ found: [fab] }, 'plugins', 'paper')).toBeNull();
    expect(pickLoader({ found: [] }, 'mods', 'fabric')).toBeNull();
  });
});
```

- [ ] **Step 3 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/jar-inspector.test.ts`
Expected: FAIL, module `./jar-inspector.js` introuvable.

- [ ] **Step 4 : implémenter l'inspecteur**

`packages/backend/src/mods/jar-inspector.ts` :

```ts
import yauzl from 'yauzl';
import type { JarMeta, ModsDir } from '@mc/common';

export type JarLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'paper';
export interface JarInfo { found: { loader: JarLoader; meta: JarMeta | null }[] }
/** Au-delà, le descripteur est ignoré (meta null) : un jar piégé ne doit pas remplir la mémoire. */
export const DESCRIPTOR_LIMIT = 1024 * 1024;

export class JarError extends Error {
  code = 'not_a_jar' as const;
  constructor(message: string) { super(message); this.name = 'JarError'; }
}

const DESCRIPTORS: Record<string, JarLoader> = {
  'fabric.mod.json': 'fabric',
  'quilt.mod.json': 'quilt',
  'META-INF/neoforge.mods.toml': 'neoforge',
  'META-INF/mods.toml': 'forge',
  'paper-plugin.yml': 'paper',
  'plugin.yml': 'paper',
};

const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const tomlKey = (text: string, key: string): string | null => { const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(text); return m ? str(m[1]) : null; };
const yamlKey = (text: string, key: string): string | null => { const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(text); return m ? str(unquote(m[1])) : null; };

/** Métadonnées du descripteur ; null si le contenu n'est pas exploitable (jamais d'exception). */
export function parseDescriptor(loader: JarLoader, text: string): JarMeta | null {
  try {
    if (loader === 'fabric') { const j = JSON.parse(text) as Record<string, unknown>; return { id: str(j.id), name: str(j.name), version: str(j.version) }; }
    if (loader === 'quilt') {
      const j = JSON.parse(text) as { quilt_loader?: Record<string, unknown>; metadata?: Record<string, unknown> };
      return { id: str(j.quilt_loader?.id), name: str(j.metadata?.name), version: str(j.quilt_loader?.version) };
    }
    if (loader === 'forge' || loader === 'neoforge') return { id: tomlKey(text, 'modId'), name: tomlKey(text, 'displayName'), version: tomlKey(text, 'version') };
    const name = yamlKey(text, 'name');
    return { id: name, name, version: yamlKey(text, 'version') };
  } catch { return null; }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zf) => (err || !zf ? reject(err ?? new Error('no zipfile')) : resolve(zf))));
}

/** Lit une entrée jusqu'à DESCRIPTOR_LIMIT octets ; null si elle dépasse. */
function readEntry(zf: yauzl.ZipFile, entry: yauzl.Entry): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (entry.uncompressedSize > DESCRIPTOR_LIMIT) { resolve(null); return; }
    zf.openReadStream(entry, (err, stream) => {
      if (err || !stream) { reject(err ?? new Error('no stream')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => { size += c.length; if (size > DESCRIPTOR_LIMIT) { stream.destroy(); resolve(null); return; } chunks.push(c); });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}

/** Parcourt l'archive sans rien extraire sur le disque et renvoie les descripteurs trouvés dans l'ordre de l'archive. */
export async function inspectJar(file: string): Promise<JarInfo> {
  let zf: yauzl.ZipFile;
  try { zf = await openZip(file); }
  catch (err) { throw new JarError(`Not a zip archive: ${(err as Error).message}`); }
  const found: JarInfo['found'] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('error', (err: Error) => reject(new JarError(`Corrupt archive: ${err.message}`)));
      zf.on('end', resolve);
      zf.on('entry', (entry: yauzl.Entry) => {
        const loader = DESCRIPTORS[entry.fileName];
        if (!loader) { zf.readEntry(); return; }
        readEntry(zf, entry)
          .then((text) => { found.push({ loader, meta: text === null ? null : parseDescriptor(loader, text) }); zf.readEntry(); })
          .catch((err) => reject(new JarError(`Corrupt entry ${entry.fileName}: ${(err as Error).message}`)));
      });
      zf.readEntry();
    });
  } finally { zf.close(); }
  return { found };
}

const FAMILY: Record<string, JarLoader[]> = {
  fabric: ['fabric', 'quilt'], quilt: ['quilt', 'fabric'],
  forge: ['forge', 'neoforge'], neoforge: ['neoforge', 'forge'],
  paper: ['paper'], spigot: ['paper'], bukkit: ['paper'], purpur: ['paper'], folia: ['paper'],
};

/** Le descripteur compatible avec le serveur (le loader exact d'abord, puis sa famille), ou null. */
export function pickLoader(info: JarInfo, dir: ModsDir, serverLoader: string): { loader: JarLoader; meta: JarMeta | null } | null {
  const accepted = FAMILY[serverLoader] ?? (dir === 'plugins' ? ['paper'] : []);
  for (const l of accepted) { const hit = info.found.find((f) => f.loader === l); if (hit) return hit; }
  return null;
}
```

- [ ] **Step 5 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/jar-inspector.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (11 tests). Si `yauzl` pose un problème d'import ESM (`default` absent), utiliser `import * as yauzl from 'yauzl'` et consigner la décision.

- [ ] **Step 6 : commit**

```bash
git add packages/backend/src/mods/test-zip.ts packages/backend/src/mods/jar-inspector.ts packages/backend/src/mods/jar-inspector.test.ts
git commit -m "feat(lot4): inspecteur de jar (descripteurs Fabric, Quilt, Forge, NeoForge, Paper) et écrivain zip de test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : recherche dans le client Modrinth et le fake

**Files:**
- Modify: `packages/backend/src/mods/modrinth-client.ts`
- Modify: `packages/backend/src/mods/fake-modrinth.ts`
- Test: `packages/backend/src/mods/modrinth-client.test.ts`

**Interfaces:**
- Produces: `ModrinthLike.search(q: string, opts: { loader: string; gameVersion: string | null; limit: number }): Promise<RawSearchHit[]>` avec `interface RawSearchHit { slug; projectId; title; description; iconUrl; author; downloads; follows; latestVersion }` (= `ModrinthSearchHit` sans `alreadyListed`) ; `FakeModrinth.hits: RawSearchHit[]`, `FakeModrinth.searches: { q: string; loader: string; gameVersion: string | null }[]`.

- [ ] **Step 1 : écrire les tests**

Ajouter à `packages/backend/src/mods/modrinth-client.test.ts` :

```ts
describe('realModrinth.search', () => {
  const hit = { slug: 'xaeros-minimap', project_id: '1bokaNcj', title: "Xaero's Minimap", description: 'A minimap.', icon_url: 'https://cdn.modrinth.com/m.png', author: 'xaero96', downloads: 12345678, follows: 4321, latest_version: '24.2.0' };
  it('encodes the query and facets, maps hits', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { hits: [hit, { slug: 'nope' }] }));
    const hits = await realModrinth(fetchFn as unknown as typeof fetch).search('mini map & co #1', { loader: 'fabric', gameVersion: '1.21.1', limit: 20 });
    const url = new URL((fetchFn.mock.calls[0] as [string])[0]);
    expect(url.origin + url.pathname).toBe('https://api.modrinth.com/v2/search');
    expect(url.searchParams.get('query')).toBe('mini map & co #1');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('index')).toBe('relevance');
    expect(JSON.parse(url.searchParams.get('facets')!)).toEqual([['project_type:mod'], ['categories:fabric'], ['versions:1.21.1']]);
    expect(hits).toEqual([{ slug: 'xaeros-minimap', projectId: '1bokaNcj', title: "Xaero's Minimap", description: 'A minimap.', iconUrl: 'https://cdn.modrinth.com/m.png', author: 'xaero96', downloads: 12345678, follows: 4321, latestVersion: '24.2.0' }]);
  });
  it('omits the version facet when unknown and tolerates missing optional fields', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { hits: [{ slug: 'a', project_id: 'b', title: 'A' }] }));
    const hits = await realModrinth(fetchFn as unknown as typeof fetch).search('a', { loader: 'paper', gameVersion: null, limit: 5 });
    expect(JSON.parse(new URL((fetchFn.mock.calls[0] as [string])[0]).searchParams.get('facets')!)).toEqual([['project_type:mod'], ['categories:paper']]);
    expect(hits).toEqual([{ slug: 'a', projectId: 'b', title: 'A', description: null, iconUrl: null, author: null, downloads: 0, follows: 0, latestVersion: null }]);
  });
  it('throws ModrinthUnavailable on errors and malformed payloads', async () => {
    await expect(realModrinth(vi.fn().mockImplementation(() => json(503, {})) as unknown as typeof fetch).search('a', { loader: 'fabric', gameVersion: null, limit: 5 })).rejects.toBeInstanceOf(ModrinthUnavailable);
    await expect(realModrinth(vi.fn().mockImplementation(() => json(200, { nope: 1 })) as unknown as typeof fetch).search('a', { loader: 'fabric', gameVersion: null, limit: 5 })).rejects.toBeInstanceOf(ModrinthUnavailable);
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/modrinth-client.test.ts`
Expected: FAIL, `search is not a function`.

- [ ] **Step 3 : implémenter**

Dans `modrinth-client.ts`, ajouter après `ModrinthProjectInfo` :

```ts
export interface RawSearchHit { slug: string; projectId: string; title: string; description: string | null; iconUrl: string | null; author: string | null; downloads: number; follows: number; latestVersion: string | null }
export interface SearchOpts { loader: string; gameVersion: string | null; limit: number }
```

étendre `ModrinthLike` :

```ts
  /** Recherche de projets de type mod pour un loader (et une version MC si connue). */
  search(q: string, opts: SearchOpts): Promise<RawSearchHit[]>;
```

et factoriser la requête dans `realModrinth` :

```ts
async function request(fetchFn: typeof fetch, url: string): Promise<Response> {
  try { return await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (err) { throw new ModrinthUnavailable(`Modrinth request failed: ${(err as Error).message}`); }
}
async function body(res: Response): Promise<unknown> {
  if (!res.ok) throw new ModrinthUnavailable(`Modrinth answered ${res.status}`);
  try { return await res.json(); } catch { throw new ModrinthUnavailable('Modrinth answered with invalid JSON'); }
}
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const optStr = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

export function realModrinth(fetchFn: typeof fetch = fetch): ModrinthLike {
  return {
    async getProject(slug) {
      const res = await request(fetchFn, `${BASE}/project/${encodeURIComponent(slug)}`);
      if (res.status === 404) return null;
      const b = (await body(res)) as Record<string, unknown>;
      if (!b || typeof b.id !== 'string' || typeof b.slug !== 'string' || typeof b.title !== 'string' || typeof b.project_type !== 'string') throw new ModrinthUnavailable('Modrinth answered with an unexpected payload');
      return { id: b.id, slug: b.slug, title: b.title, description: optStr(b.description), iconUrl: optStr(b.icon_url), projectType: b.project_type, loaders: Array.isArray(b.loaders) ? b.loaders.filter((l): l is string => typeof l === 'string') : [] };
    },
    async search(q, opts) {
      const facets: string[][] = [['project_type:mod'], [`categories:${opts.loader}`]];
      if (opts.gameVersion) facets.push([`versions:${opts.gameVersion}`]);
      const params = new URLSearchParams({ query: q, limit: String(opts.limit), index: 'relevance', facets: JSON.stringify(facets) });
      const b = (await body(await request(fetchFn, `${BASE}/search?${params}`))) as { hits?: unknown };
      if (!b || !Array.isArray(b.hits)) throw new ModrinthUnavailable('Modrinth answered with an unexpected payload');
      return b.hits.flatMap((h: unknown): RawSearchHit[] => {
        const r = h as Record<string, unknown>;
        if (typeof r.slug !== 'string' || typeof r.project_id !== 'string' || typeof r.title !== 'string') return [];
        return [{ slug: r.slug, projectId: r.project_id, title: r.title, description: optStr(r.description), iconUrl: optStr(r.icon_url), author: optStr(r.author), downloads: num(r.downloads), follows: num(r.follows), latestVersion: optStr(r.latest_version) }];
      });
    },
  };
}
```

(supprimer l'ancienne implémentation de `getProject`, remplacée ci-dessus ; les tests existants de `getProject` doivent rester verts.)

Dans `fake-modrinth.ts` :

```ts
  hits: RawSearchHit[] = [];
  searches: { q: string; loader: string; gameVersion: string | null }[] = [];
  async search(q: string, opts: SearchOpts): Promise<RawSearchHit[]> {
    this.searches.push({ q, loader: opts.loader, gameVersion: opts.gameVersion });
    if (this.down) throw new ModrinthUnavailable('fake down');
    return this.hits.slice(0, opts.limit);
  }
```

(importer `RawSearchHit` et `SearchOpts`.)

- [ ] **Step 4 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/mods/modrinth-client.ts packages/backend/src/mods/fake-modrinth.ts packages/backend/src/mods/modrinth-client.test.ts
git commit -m "feat(lot4): recherche Modrinth dans le client et le fake

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : `ModsService.search`, cache, version Minecraft, route `GET /api/mods/search`

**Files:**
- Modify: `packages/backend/src/mods/mods-service.ts`
- Modify: `packages/backend/src/routes/mods.routes.ts`
- Modify: `packages/backend/src/index.ts` (injection `gameVersion`)
- Test: `packages/backend/src/mods/mods-service.test.ts`, `packages/backend/src/routes/mods.routes.test.ts`

**Interfaces:**
- Consumes: `ModrinthLike.search`, `FakeModrinth.hits/searches` (tâche 3), `ModsSearchResult` (tâche 1).
- Produces: `ModsDeps.gameVersion?: () => string | null`, `ModsService.search(q: string): Promise<ModsSearchResult>`, `GET /api/mods/search?q=`.

- [ ] **Step 1 : tests du service**

Dans `mods-service.test.ts`, la fabrique `setup` accepte `gameVersion?: string | null` et le passe : `new ModsService({ dataDir, docker, modrinth, prisma, lock, broadcast: (m) => sent.push(m), gameVersion: () => opts.gameVersion ?? null })`. Ajouter un `describe` :

```ts
describe('ModsService.search', () => {
  const hit = { slug: 'xaeros-minimap', projectId: '1', title: 'Xaero', description: null, iconUrl: null, author: null, downloads: 1, follows: 0, latestVersion: null };
  it('queries Modrinth with the server loader and the running game version, flagging listed slugs', async () => {
    const { svc, modrinth } = await setup({ listing: 'xaeros-minimap\n', gameVersion: '1.21.1' });
    modrinth.hits = [hit, { ...hit, slug: 'other', projectId: '2' }];
    const r = await svc.search('  xaero  ');
    expect(modrinth.searches).toEqual([{ q: 'xaero', loader: 'fabric', gameVersion: '1.21.1' }]);
    expect(r).toEqual({ loader: 'fabric', gameVersion: '1.21.1', hits: [{ ...hit, alreadyListed: true }, { ...hit, slug: 'other', projectId: '2', alreadyListed: false }] });
  });
  it('falls back on the container VERSION when numeric, else searches without version', async () => {
    const { svc, modrinth } = await setup({ env: ['TYPE=FABRIC', 'VERSION=1.20.4'], gameVersion: null });
    await svc.search('ab');
    expect(modrinth.searches[0].gameVersion).toBe('1.20.4');
    const { svc: s2, modrinth: m2 } = await setup({ env: ['TYPE=PAPER', 'VERSION=LATEST'], gameVersion: null });
    expect((await s2.search('ab')).gameVersion).toBeNull();
    expect(m2.searches[0]).toEqual({ q: 'ab', loader: 'paper', gameVersion: null });
  });
  it('caches a query for 60 s but recomputes alreadyListed, and truncates long queries', async () => {
    const { svc, modrinth } = await setup({ listing: '' });
    modrinth.hits = [hit];
    await svc.search('xaero');
    await svc.add('xaeros-minimap').catch(() => undefined); // inconnu du fake getProject : 404, mais sans effet sur le cache
    modrinth.add({ slug: 'xaeros-minimap' });
    await svc.add('xaeros-minimap');
    const r = await svc.search('xaero');
    expect(modrinth.searches.length).toBe(1);
    expect(r.hits[0].alreadyListed).toBe(true);
    await svc.search('x'.repeat(200));
    expect(modrinth.searches[1].q.length).toBe(100);
  });
  it('rejects short queries, unsupported servers and surfaces Modrinth outages', async () => {
    const { svc, modrinth } = await setup({});
    expect(await codeOf(svc.search(' a '))).toEqual([400, 'invalid_query']);
    modrinth.down = true;
    expect(await codeOf(svc.search('abc'))).toEqual([502, 'modrinth_unavailable']);
    const { svc: v } = await setup({ env: ['TYPE=VANILLA'] });
    expect(await codeOf(v.search('abc'))).toEqual([409, 'unsupported_server']);
  });
});
```

(`codeOf` est déjà défini plus haut dans le fichier ; déplacer sa définition avant ce `describe` si nécessaire.)

- [ ] **Step 2 : tests de la route**

Dans `mods.routes.test.ts`, ajouter `search: vi.fn().mockResolvedValue({ loader: 'fabric', gameVersion: null, hits: [] })` au mock `app.locals.mods`, puis :

```ts
  it('search is open to viewers, validates q and is not audited', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/mods/search?q=xaero')).status).toBe(200);
    expect(app.locals.mods.search).toHaveBeenCalledWith('xaero');
    expect((await request(app).get('/api/mods/search')).status).toBe(400);
    expect((await request(app).get('/api/mods/search?q=')).body.code).toBe('invalid_query');
    expect(audited(app)).toEqual([]);
  });
```

- [ ] **Step 3 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/mods-service.test.ts src/routes/mods.routes.test.ts`
Expected: FAIL sur les nouveaux cas (`search is not a function`, 404 sur la route).

- [ ] **Step 4 : implémenter le service**

Dans `mods-service.ts` :

```ts
import type { ..., ModsSearchResult, ModrinthSearchHit } from '@mc/common';
import { envMap, ... } from './server-type.js';

export interface ModsDeps {
  // ...
  /** Version Minecraft en cours d'exécution (lue dans les logs par le collecteur), null si inconnue. */
  gameVersion?: () => string | null;
}

const SEARCH_TTL_MS = 60_000;
const SEARCH_CACHE_MAX = 50;
const SEARCH_LIMIT = 20;
const VERSION_RE = /^\d+\.\d+(\.\d+)?$/;
```

et dans la classe :

```ts
  private searchCache = new Map<string, { at: number; hits: Omit<ModrinthSearchHit, 'alreadyListed'>[] }>();

  /** Version MC pour filtrer la recherche : logs du serveur, sinon VERSION du conteneur si numérique, sinon null. */
  private gameVersion(env: string[]): string | null {
    const running = this.deps.gameVersion?.() ?? null;
    if (running && VERSION_RE.test(running)) return running;
    const v = (envMap(env).get('VERSION') ?? '').trim();
    return VERSION_RE.test(v) ? v : null;
  }

  async search(raw: string): Promise<ModsSearchResult> {
    const q = raw.trim().slice(0, 100);
    if (q.length < 2) this.fail(400, 'invalid_query', 'Query must have at least 2 characters');
    const inspect = await this.inspect();
    const server = inspect ? serverTypeOf(inspect.env) : null;
    if (!server) this.fail(409, 'unsupported_server', 'Mods are only managed for modded or plugin servers (TYPE=FABRIC, PAPER, ...)');
    const gameVersion = this.gameVersion(inspect!.env);
    const key = `${q}\u0000${server.loader}\u0000${gameVersion ?? ''}`;
    const now = Date.now();
    let entry = this.searchCache.get(key);
    if (!entry || entry.at + SEARCH_TTL_MS < now) {
      let hits;
      try { hits = await this.deps.modrinth.search(q, { loader: server.loader, gameVersion, limit: SEARCH_LIMIT }); }
      catch (err) { if (err instanceof ModrinthUnavailable) this.fail(502, 'modrinth_unavailable', err.message); throw err; }
      entry = { at: now, hits };
      this.searchCache.delete(key);
      this.searchCache.set(key, entry);
      while (this.searchCache.size > SEARCH_CACHE_MAX) this.searchCache.delete(this.searchCache.keys().next().value!);
    }
    const listed = new Set((await readListing(this.listingPath)).lines.filter(isManaged).map((l) => slugOf(l.entry)));
    return { loader: server.loader, gameVersion, hits: entry.hits.map((h) => ({ ...h, alreadyListed: listed.has(h.slug) })) };
  }
```

- [ ] **Step 5 : route et injection**

Dans `mods.routes.ts`, avant `modsRoutes.post('/import', …)` :

```ts
modsRoutes.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.trim().length < 2) throw new AppError(400, 'Query must have at least 2 characters', undefined, 'invalid_query');
    res.json(await req.app.locals.mods.search(q));
  } catch (err) { next(err); }
});
```

Dans `index.ts`, ajouter `gameVersion: () => metrics.latest().version` aux dépendances de `ModsService`.

- [ ] **Step 6 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods src/routes/mods.routes.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7 : commit**

```bash
git add packages/backend/src/mods/mods-service.ts packages/backend/src/mods/mods-service.test.ts packages/backend/src/routes/mods.routes.ts packages/backend/src/routes/mods.routes.test.ts packages/backend/src/index.ts
git commit -m "feat(lot4): recherche dans le catalogue Modrinth, cache 60 s, filtre loader et version

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : `ModsService.upload`, `deleteFile`, `start()`, métadonnées des jars manuels

**Files:**
- Modify: `packages/backend/src/mods/mods-service.ts`
- Test: `packages/backend/src/mods/mods-service.test.ts`

**Interfaces:**
- Consumes: `inspectJar`, `pickLoader`, `JarError` (tâche 2), `writeZip` (test), `MAX_UPLOAD_BYTES` (tâche 1).
- Produces: `ModsService.start(): Promise<void>`, `ModsService.upload(opts: { name: string; replace: boolean; declaredSize: number; body: Readable }): Promise<void>`, `ModsService.deleteFile(file: string): Promise<void>`, `ManualMod.meta` renseigné, `UPLOAD_NAME_RE` exporté, `tmpDir` (`<dataDir>/mc-manager/tmp`).

- [ ] **Step 1 : écrire les tests**

Dans `mods-service.test.ts`, imports supplémentaires : `import { Readable } from 'stream';`, `import { writeZip } from './test-zip.js';`, `import { MAX_UPLOAD_BYTES } from '@mc/common';`. Helper :

```ts
async function fabricJar(id = 'xaeros', name = "Xaero's", version = '24.2'): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mc-up-'));
  const f = path.join(dir, 'x.jar');
  await writeZip(f, { 'fabric.mod.json': JSON.stringify({ id, name, version }), 'a/B.class': 'x' });
  return readFile(f);
}
const up = (svc: ModsService, buf: Buffer, name = 'xaeros.jar', replace = false, declaredSize = buf.length) => svc.upload({ name, replace, declaredSize, body: Readable.from(buf) });
const parts = (dataDir: string) => readdir(path.join(dataDir, 'mc-manager', 'tmp')).catch(() => [] as string[]);
```

Puis le bloc :

```ts
describe('ModsService.upload / deleteFile', () => {
  it('stores a verified Fabric jar, exposes its metadata and asks for a restart', async () => {
    const { svc, dataDir, modsDir, sent } = await setup({ listing: '' });
    await up(svc, await fabricJar());
    expect(await modsDir()).toEqual(['xaeros.jar']);
    expect(await parts(dataDir)).toEqual([]);
    expect(sent).toEqual([{ type: 'mods.changed' }]);
    const v = await svc.view();
    expect(v.manual).toEqual([expect.objectContaining({ file: 'xaeros.jar', enabled: true, meta: { id: 'xaeros', name: "Xaero's", version: '24.2' } })]);
    expect(v.restartRequired).toBe(true);
  });
  it('rejects bad names, oversized declarations, non-jars and jars for another loader, leaving no temp file', async () => {
    const { svc, dataDir, modsDir } = await setup({ listing: '' });
    const jar = await fabricJar();
    expect(await codeOf(up(svc, jar, '../x.jar'))).toEqual([400, 'invalid_name']);
    expect(await codeOf(up(svc, jar, 'x.txt'))).toEqual([400, 'invalid_name']);
    expect(await codeOf(up(svc, jar, 'ok.jar', false, MAX_UPLOAD_BYTES + 1))).toEqual([413, 'too_large']);
    expect(await codeOf(up(svc, Buffer.from('not a zip'), 'bad.jar'))).toEqual([422, 'not_a_jar']);
    const d = await mkdtemp(path.join(tmpdir(), 'mc-up-')); const f = path.join(d, 'p.jar');
    await writeZip(f, { 'plugin.yml': 'name: Essentials\nversion: 1\n' });
    const res = await up(svc, await readFile(f), 'ess.jar').then(() => null, (e: AppError) => e);
    expect([res?.statusCode, res?.code, res?.details]).toEqual([422, 'wrong_loader', 'paper']);
    await writeZip(f, { 'a/B.class': 'x' });
    expect((await up(svc, await readFile(f), 'lib.jar').then(() => null, (e: AppError) => e))?.details).toBe('none');
    expect(await modsDir().catch(() => [])).toEqual([]);
    expect(await parts(dataDir)).toEqual([]);
  });
  it('stops a body that exceeds the limit regardless of Content-Length', async () => {
    const { svc, dataDir } = await setup({ listing: '' });
    const big = Readable.from((async function* () { for (let i = 0; i < 110; i++) yield Buffer.alloc(1024 * 1024, 1); })());
    const r = await svc.upload({ name: 'big.jar', replace: false, declaredSize: 10, body: big }).then(() => null, (e: AppError) => e);
    expect([r?.statusCode, r?.code]).toEqual([413, 'too_large']);
    expect(await parts(dataDir)).toEqual([]);
  });
  it('refuses duplicates by name unless replace, and by mod id', async () => {
    const { svc, modsDir } = await setup({ listing: '' });
    await up(svc, await fabricJar('xaeros', 'X', '1'));
    expect(await codeOf(up(svc, await fabricJar('xaeros', 'X', '2')))).toEqual([409, 'exists']);
    const dup = await up(svc, await fabricJar('xaeros', 'X', '2'), 'xaeros-v2.jar').then(() => null, (e: AppError) => e);
    expect([dup?.statusCode, dup?.code, dup?.details]).toEqual([409, 'duplicate_mod', 'xaeros.jar']);
    await up(svc, await fabricJar('xaeros', 'X', '2'), 'xaeros.jar', true);
    expect((await svc.view()).manual[0].meta?.version).toBe('2');
    await svc.setFileEnabled('xaeros.jar', false);
    expect(await codeOf(up(svc, await fabricJar('xaeros', 'X', '3')))).toEqual([409, 'exists']);
    await up(svc, await fabricJar('xaeros', 'X', '3'), 'xaeros.jar', true); // remplace la forme .disabled : une seule forme reste, active
    expect(await modsDir()).toEqual(['xaeros.jar']);
  });
  it('refuses to overwrite a Modrinth-managed jar even with replace', async () => {
    const { svc, modsDir } = await setup({ listing: 'lithium\n', manifest: { files: ['mods/lithium.jar'], projects: ['lithium'] }, mods: { 'lithium.jar': 'managed' } });
    expect(await codeOf(up(svc, await fabricJar('lithium'), 'lithium.jar', true))).toEqual([409, 'managed']);
    expect(await readFile(path.join((svc as unknown as { deps: { dataDir: string } }).deps.dataDir, 'mods', 'lithium.jar'), 'utf8')).toBe('managed');
    expect(await modsDir()).toEqual(['lithium.jar']);
  });
  it('leaves no temp file when the data lock is busy', async () => {
    const { svc, lock, dataDir } = await setup({ listing: '' });
    const release = lock.acquire('restore');
    expect(await codeOf(up(svc, await fabricJar()))).toEqual([409, 'busy']);
    release();
    expect(await parts(dataDir)).toEqual([]);
  });
  it('deletes a manual jar (both forms), never a managed one', async () => {
    const { svc, modsDir, sent } = await setup({ listing: '', manifest: { files: ['mods/lithium.jar'], projects: [] }, mods: { 'lithium.jar': 'm', 'x.jar': 'a', 'x.jar.disabled': 'b', 'y.jar': 'c' } });
    await svc.deleteFile('x.jar');
    await svc.deleteFile('y.jar');
    expect((await modsDir()).sort()).toEqual(['lithium.jar']);
    expect(sent.length).toBe(2);
    expect(await codeOf(svc.deleteFile('lithium.jar'))).toEqual([404, 'not_found']);
    expect(await codeOf(svc.deleteFile('../x.jar'))).toEqual([404, 'not_found']);
    expect((await svc.view()).restartRequired).toBe(true);
  });
  it('start() purges orphan .part files and nothing else', async () => {
    const { svc, dataDir } = await setup({ listing: '' });
    await mkdir(path.join(dataDir, 'mc-manager', 'tmp'), { recursive: true });
    await writeFile(path.join(dataDir, 'mc-manager', 'tmp', 'old.part'), 'x');
    await writeFile(path.join(dataDir, 'mc-manager', 'tmp', 'keep.txt'), 'x');
    await svc.start();
    expect(await parts(dataDir)).toEqual(['keep.txt']);
    const { svc: fresh } = await setup({});
    await expect(fresh.start()).resolves.toBeUndefined(); // dossier absent : rien à faire
  });
  it('caches jar metadata by size and mtime', async () => {
    const { svc, dataDir } = await setup({ listing: '' });
    await up(svc, await fabricJar('a', 'A', '1'), 'a.jar');
    expect((await svc.view()).manual[0].meta?.version).toBe('1');
    await writeFile(path.join(dataDir, 'mods', 'a.jar'), 'garbage'); // taille différente : ré-inspecté, illisible → null
    expect((await svc.view()).manual[0].meta).toBeNull();
  });
});
```

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/mods/mods-service.test.ts -t "upload"`
Expected: FAIL, `upload is not a function`.

- [ ] **Step 3 : implémenter**

Dans `mods-service.ts`, imports :

```ts
import { access, mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform, type Readable } from 'stream';
import { randomUUID } from 'crypto';
import { MAX_UPLOAD_BYTES, type JarMeta } from '@mc/common';   // à fusionner avec l'import de types existant de @mc/common
import { inspectJar, pickLoader, JarError } from './jar-inspector.js';
```

Constantes et helpers :

```ts
export const UPLOAD_NAME_RE = /^[A-Za-z0-9._+ ()[\]-]{1,96}\.jar$/;
const isUploadName = (n: string): boolean => UPLOAD_NAME_RE.test(n) && !n.includes('..') && path.basename(n) === n;

class TooLarge extends Error { constructor() { super('too large'); this.name = 'TooLarge'; } }
/** Compte les octets et coupe au-delà de `max` : Content-Length n'est qu'une déclaration. */
function limited(max: number): Transform {
  let seen = 0;
  return new Transform({ transform(chunk: Buffer, _enc, cb) { seen += chunk.length; if (seen > max) cb(new TooLarge()); else cb(null, chunk); } });
}
```

Dans la classe :

```ts
  readonly tmpDir: string;
  private metaCache = new Map<string, { size: number; mtimeMs: number; meta: JarMeta | null }>();

  constructor(protected deps: ModsDeps) {
    this.listingPath = path.join(deps.dataDir, LISTING_RELATIVE);
    this.tmpDir = path.join(deps.dataDir, 'mc-manager', 'tmp');
  }

  /** Au démarrage : supprime les .part laissés par un upload interrompu. */
  async start(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.tmpDir); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; throw err; }
    for (const n of names) if (n.endsWith('.part')) await rm(path.join(this.tmpDir, n), { force: true }).catch((err) => logger.warn({ err, n }, 'cannot remove orphan upload'));
  }

  /** Métadonnées d'un jar, mises en cache par taille et mtime ; null si illisible. */
  private async jarMeta(file: string, size: number, mtimeMs: number, dir: ModsDir, loader: string): Promise<JarMeta | null> {
    const hit = this.metaCache.get(file);
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.meta;
    let meta: JarMeta | null = null;
    try { const info = await inspectJar(file); meta = (pickLoader(info, dir, loader) ?? info.found[0])?.meta ?? null; }
    catch { meta = null; }
    this.metaCache.set(file, { size, mtimeMs, meta });
    return meta;
  }
```

`listManual` prend un paramètre de plus, `loader: string`, et renseigne `meta` : dans la boucle, conserver `mtimeMs` (`st.mtimeMs`) et le chemin absolu de la forme retenue, puis dans le `map` final :

```ts
    const out: ManualMod[] = [];
    for (const [file, r] of [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const info = r.enabled ?? r.disabled!;
      out.push({ file, enabled: !!r.enabled, size: info.size, mtime: info.mtime.toISOString(), conflict: !!r.enabled && !!r.disabled, meta: await this.jarMeta(info.path, info.size, info.mtimeMs, dir, loader) });
    }
    return out;
```

(le type du `Map` devient `{ size: number; mtime: Date; mtimeMs: number; path: string }` pour chaque forme.) Mettre à jour les deux appels existants (`view` et `setFileEnabled`) : `this.listManual(server.dir, manifestFiles, server.loader)`.

Upload et suppression :

```ts
  async upload(opts: { name: string; replace: boolean; declaredSize: number; body: Readable }): Promise<void> {
    const { name } = opts;
    if (!isUploadName(name)) this.fail(400, 'invalid_name', 'Invalid jar file name');
    const server = await this.requireServer();
    if (!Number.isInteger(opts.declaredSize) || opts.declaredSize < 1 || opts.declaredSize > MAX_UPLOAD_BYTES) this.fail(413, 'too_large', `Jar files are limited to ${MAX_UPLOAD_BYTES} bytes`);
    await mkdir(this.tmpDir, { recursive: true }).catch((err) => { throw mapWriteError(err, this.tmpDir, this.deps.dataDir); });
    const tmp = path.join(this.tmpDir, `${randomUUID()}.part`);
    try {
      // Réception hors verrou : elle peut durer, et ne touche que mc-manager/tmp.
      try { await pipeline(opts.body, limited(MAX_UPLOAD_BYTES), createWriteStream(tmp)); }
      catch (err) {
        if (err instanceof TooLarge) this.fail(413, 'too_large', `Jar files are limited to ${MAX_UPLOAD_BYTES} bytes`);
        this.fail(400, 'upload_aborted', `Upload interrupted: ${(err as Error).message}`);
      }
      let info;
      try { info = await inspectJar(tmp); }
      catch (err) { if (err instanceof JarError) this.fail(422, 'not_a_jar', 'The file is not a valid jar archive'); throw err; }
      const picked = pickLoader(info, server.dir, server.loader);
      if (!picked) throw new AppError(422, `This jar is not a ${server.loader} ${server.dir === 'plugins' ? 'plugin' : 'mod'}`, info.found[0]?.loader ?? 'none', 'wrong_loader');
      await this.withLock(async () => {
        const manifest = await readManifest(this.deps.dataDir);
        const files = new Set(manifest?.files ?? []);
        if (files.has(`${server.dir}/${name}`)) this.fail(409, 'managed', `${name} is managed by Modrinth: remove it from the list instead`);
        const manual = await this.listManual(server.dir, files, server.loader);
        const existing = manual.find((m) => m.file === name);
        if (existing && !opts.replace) this.fail(409, 'exists', `${name} already exists`);
        const id = picked.meta?.id;
        const other = id ? manual.find((m) => m.file !== name && m.meta?.id === id) : undefined;
        if (other) throw new AppError(409, `Mod ${id} is already provided by ${other.file}`, other.file, 'duplicate_mod');
        const dir = path.join(this.deps.dataDir, server.dir);
        await mkdir(dir, { recursive: true });
        try {
          if (opts.replace) await rm(path.join(dir, `${name}.disabled`), { force: true });
          await rename(tmp, path.join(dir, name));
        } catch (err) { throw mapWriteError(err, path.join(dir, name), dir); }
        this.lastFileWriteAt = new Date();
        return { changed: true, result: undefined };
      });
    } finally { await rm(tmp, { force: true }).catch(() => undefined); }
  }

  /** Supprime définitivement un jar manuel (ses deux formes si présentes) ; jamais un jar géré par Modrinth. */
  async deleteFile(file: string): Promise<void> {
    if (!/^[^/\\]+\.jar$/.test(file) || file.includes('..') || path.basename(file) !== file) this.fail(404, 'not_found', 'Unknown file');
    const server = await this.requireServer();
    await this.withLock(async () => {
      const manifest = await readManifest(this.deps.dataDir);
      const manual = await this.listManual(server.dir, new Set(manifest?.files ?? []), server.loader);
      if (!manual.some((m) => m.file === file)) this.fail(404, 'not_found', 'Unknown file');
      const dir = path.join(this.deps.dataDir, server.dir);
      try { await rm(path.join(dir, file), { force: true }); await rm(path.join(dir, `${file}.disabled`), { force: true }); }
      catch (err) { throw mapWriteError(err, path.join(dir, file), dir); }
      this.metaCache.delete(path.join(dir, file)); this.metaCache.delete(path.join(dir, `${file}.disabled`));
      this.lastFileWriteAt = new Date();
      return { changed: true, result: undefined };
    });
  }
```

Note : `rename` écrase la destination sur POSIX et Windows (Node utilise `MoveFileEx` avec remplacement), ce qui réalise `replace`. La vérification `existing && !opts.replace` protège le cas sans `replace`.

- [ ] **Step 4 : lancer les tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/mods && pnpm typecheck && pnpm lint`
Expected: PASS. Les tests existants de `listManual` restent verts (`meta` s'ajoute aux objets ; les assertions `toEqual` sur `v.manual.map(...)` ne regardent que les champs projetés).

- [ ] **Step 5 : commit**

```bash
git add packages/backend/src/mods/mods-service.ts packages/backend/src/mods/mods-service.test.ts
git commit -m "feat(lot4): dépôt d'un jar vérifié, suppression d'un jar manuel, métadonnées des jars, purge des uploads interrompus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : routes upload et delete, démarrage, nginx

**Files:**
- Modify: `packages/backend/src/routes/mods.routes.ts`
- Modify: `packages/backend/src/index.ts` (`await mods.start()`)
- Modify: `Dockerfile.frontend`
- Test: `packages/backend/src/routes/mods.routes.test.ts`

**Interfaces:**
- Consumes: `ModsService.upload/deleteFile/start`, `UPLOAD_NAME_RE` (tâche 5), `MAX_UPLOAD_BYTES` (tâche 1).
- Produces: `POST /api/mods/upload?name=&replace=`, `DELETE /api/mods/files/:file`.

- [ ] **Step 1 : tests de routes**

Dans `mods.routes.test.ts`, ajouter au mock `upload: vi.fn().mockResolvedValue(undefined), deleteFile: vi.fn().mockResolvedValue(undefined)`, puis :

```ts
  it('upload streams the raw body to the service with name, replace and declared size, audited', async () => {
    const app = appWith('admin');
    const body = Buffer.from('PK\u0003\u0004fake');
    const res = await request(app).post('/api/mods/upload?name=My%20Mod.jar&replace=1').set('Content-Type', 'application/java-archive').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(view);
    const call = app.locals.mods.upload.mock.calls[0][0];
    expect(call.name).toBe('My Mod.jar');
    expect(call.replace).toBe(true);
    expect(call.declaredSize).toBe(body.length);
    expect(typeof call.body.pipe).toBe('function');
    expect(audited(app)).toEqual([['mods.upload', `My Mod.jar ${body.length}`]]);
  });
  it('upload validates name and Content-Length before reading, refuses viewers', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/mods/upload?name=..%2Fx.jar').send('x')).body.code).toBe('invalid_name');
    expect((await request(app).post('/api/mods/upload?name=x.txt').send('x')).body.code).toBe('invalid_name');
    expect((await request(app).post('/api/mods/upload').send('x')).body.code).toBe('invalid_name');
    expect((await request(app).post('/api/mods/upload?name=x.jar').set('Content-Length', String(200 * 1024 * 1024)).set('Content-Type', 'application/octet-stream')).body.code).toBe('too_large');
    expect(app.locals.mods.upload).not.toHaveBeenCalled();
    expect((await request(appWith('viewer')).post('/api/mods/upload?name=x.jar').send('x')).status).toBe(403);
  });
  it('delete removes a manual jar, audited', async () => {
    const app = appWith('admin');
    expect((await request(app).delete('/api/mods/files/My%20Mod.jar')).status).toBe(200);
    expect(app.locals.mods.deleteFile).toHaveBeenCalledWith('My Mod.jar');
    expect(audited(app)).toEqual([['mods.file.delete', 'My Mod.jar']]);
    expect((await request(app).delete('/api/mods/files/..%2Fx.jar')).status).toBe(404);
    expect((await request(appWith('viewer')).delete('/api/mods/files/x.jar')).status).toBe(403);
  });
```

Le test « too_large » avec un `Content-Length` déclaré mais sans corps : supertest peut rejeter la requête côté client (`socket hang up`) quand le serveur répond avant la fin du corps. Si c'est le cas, envoyer un petit corps `.send('x')` avec `Content-Length` forcé et accepter soit `413` soit une erreur réseau, ou tester cette branche directement sur le handler ; consigner la décision.

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/mods.routes.test.ts`
Expected: FAIL (404 sur les routes).

- [ ] **Step 3 : implémenter les routes**

Dans `mods.routes.ts` :

```ts
import { MAX_UPLOAD_BYTES } from '@mc/common';
import { UPLOAD_NAME_RE } from '../mods/mods-service.js';

modsRoutes.post('/upload', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    if (!UPLOAD_NAME_RE.test(name) || name.includes('..')) throw new AppError(400, 'Invalid jar file name', undefined, 'invalid_name');
    const replace = req.query.replace === '1' || req.query.replace === 'true';
    const declaredSize = Number.parseInt(String(req.headers['content-length'] ?? ''), 10);
    if (!Number.isInteger(declaredSize)) throw new AppError(411, 'Content-Length is required');
    if (declaredSize < 1 || declaredSize > MAX_UPLOAD_BYTES) throw new AppError(413, `Jar files are limited to ${MAX_UPLOAD_BYTES} bytes`, undefined, 'too_large');
    await req.app.locals.mods.upload({ name, replace, declaredSize, body: req });
    await audit(req, 'mods.upload', `${name} ${declaredSize}`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.delete('/files/:file', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = fileParam(req);
    await req.app.locals.mods.deleteFile(file);
    await audit(req, 'mods.file.delete', file);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});
```

Point d'attention : quand le handler répond avant d'avoir lu le corps (413), Express/Node gardent la connexion ouverte jusqu'à la fin du corps ; ajouter `res.set('Connection', 'close')` via l'error handler n'est pas nécessaire car nginx a déjà refusé en amont les corps > 100 Mo. Rien à faire de plus.

Dans `index.ts`, après la construction de `ModsService` : `await app.locals.mods.start();` (avant `server.listen`), avec le commentaire « purge des uploads interrompus ».

- [ ] **Step 4 : nginx**

Dans `Dockerfile.frontend`, insérer avant le bloc `location /api {` :

```
    # Jar uploads: raw body up to 100 MB, streamed to the backend (which enforces the same limit).\n\
    location = /api/mods/upload {\n\
        client_max_body_size 100m;\n\
        proxy_request_buffering off;\n\
        proxy_pass http://backend:3001;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
        proxy_read_timeout 10m;\n\
        proxy_send_timeout 10m;\n\
    }\n\
\n\
```

Run: `docker build -f Dockerfile.frontend -t mc-frontend-test . && docker run --rm --entrypoint nginx mc-frontend-test -t`
Expected: `syntax is ok` / `test is successful` (le `proxy_pass` vers `backend` non résolu n'empêche pas `nginx -t`). Sans Docker local, consigner que la vérification se fera en CI (le job construit l'image).

- [ ] **Step 5 : tests, typecheck, lint**

Run: `pnpm --filter @mc/backend exec vitest run src/routes/mods.routes.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6 : commit**

```bash
git add packages/backend/src/routes/mods.routes.ts packages/backend/src/routes/mods.routes.test.ts packages/backend/src/index.ts Dockerfile.frontend
git commit -m "feat(lot4): routes d'upload et de suppression de jar, purge au démarrage, limite nginx à 100 Mo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : frontend, client API, i18n, recherche dans la carte Modrinth

**Files:**
- Modify: `packages/frontend/src/api/mods.api.ts`
- Modify: `packages/frontend/scripts/i18n-fragments/mods.json`
- Create: `packages/frontend/src/components/mods/ModSearchBox.tsx`
- Modify: `packages/frontend/src/components/mods/ModrinthList.tsx` (remplace `AddModForm`)
- Delete: `packages/frontend/src/components/mods/AddModForm.tsx`
- Modify: `packages/frontend/src/components/mods/mods-errors.ts`
- Test: `packages/frontend/src/pages/Mods.test.tsx`

**Interfaces:**
- Produces: `modsApi.search(q, signal?)`, `modsApi.upload(file, { replace, onProgress, signal })`, `modsApi.deleteFile(file)` ; composant `ModSearchBox({ onAdd, pending })` ; clés i18n `mods.search.*`, `mods.upload.*`, `mods.manual.delete*`, codes d'erreur ajoutés.

- [ ] **Step 1 : client API**

`mods.api.ts` :

```ts
import api from './client';
import type { ModsSearchResult, ModsView } from '@mc/common';

const data = (p: Promise<{ data: ModsView }>): Promise<ModsView> => p.then((r) => r.data);

export const modsApi = {
  get: (): Promise<ModsView> => data(api.get('/mods')),
  import: (): Promise<ModsView> => data(api.post('/mods/import')),
  add: (entry: string): Promise<ModsView> => data(api.post('/mods/modrinth', { entry })),
  toggle: (entry: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/modrinth/${encodeURIComponent(entry)}`, { enabled })),
  remove: (entry: string): Promise<ModsView> => data(api.delete(`/mods/modrinth/${encodeURIComponent(entry)}`)),
  toggleFile: (file: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/files/${encodeURIComponent(file)}`, { enabled })),
  deleteFile: (file: string): Promise<ModsView> => data(api.delete(`/mods/files/${encodeURIComponent(file)}`)),
  search: (q: string, signal?: AbortSignal): Promise<ModsSearchResult> => api.get('/mods/search', { params: { q }, signal }).then((r) => r.data),
  /** Corps brut, pas de timeout (gros fichiers), progression et annulation. */
  upload: (file: File, opts: { replace?: boolean; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<ModsView> =>
    data(api.post('/mods/upload', file, {
      params: { name: file.name, ...(opts.replace ? { replace: 1 } : {}) },
      headers: { 'Content-Type': 'application/java-archive' },
      timeout: 0,
      signal: opts.signal,
      onUploadProgress: (e) => opts.onProgress?.(e.total ? e.loaded / e.total : 0),
    })),
};
```

- [ ] **Step 2 : i18n**

Dans le fragment `mods.json`, ajouter (en et fr) :

```json
"search": {
  "placeholder": "Search Modrinth, or type a slug (lithium, lithium:0.14.0)",
  "filter": "{{loader}} · {{version}}", "unknownVersion": "unknown version, compatibility not checked",
  "searching": "Searching…", "none": "No mod found.", "add": "Add", "listed": "Already listed", "downloads": "{{n}} downloads", "hint": "Press Enter to add a slug directly."
},
"upload": {
  "drop": "Drop a .jar file here or click to choose", "uploading": "Uploading…", "cancel": "Cancel", "done": "Mod uploaded",
  "replace": "Replace", "replaceTitle": "Replace {{file}}?", "replaceDescription": "The existing file is overwritten; the server loads the new one at the next restart."
},
```

dans `manual` : `"delete": "Delete", "deleteTitle": "Delete {{file}} from the server?", "deleteDescription": "The file is removed permanently; nothing is kept.", "deleteConflictDescription": "Both the .jar and the .jar.disabled copies are removed."`, et dans `errors` :

```json
"invalid_query": "Type at least 2 characters.",
"invalid_name": "File name not accepted: letters, digits, dots, dashes, spaces and .jar extension only.",
"too_large": "Jar files are limited to 100 MB.",
"upload_aborted": "The upload was interrupted.",
"not_a_jar": "This file is not a valid jar archive.",
"wrong_loader": "This jar is not a mod for the server loader (detected: {{detected}}).",
"exists": "A file with this name already exists.",
"managed": "This file is managed by Modrinth: remove it from the list instead.",
"duplicate_mod": "This mod is already provided by {{other}}."
```

Versions françaises : « Rechercher sur Modrinth, ou taper un slug (lithium, lithium:0.14.0) », « version inconnue, compatibilité non vérifiée », « Recherche… », « Aucun mod trouvé. », « Ajouter », « Déjà dans la liste », « {{n}} téléchargements », « Entrée ajoute directement un slug. » ; « Déposez un fichier .jar ici ou cliquez pour choisir », « Envoi… », « Annuler », « Mod déposé », « Remplacer », « Remplacer {{file}} ? », « Le fichier existant est écrasé ; le serveur chargera le nouveau au prochain redémarrage. » ; « Supprimer », « Supprimer {{file}} du serveur ? », « Le fichier est supprimé définitivement, rien n'est conservé. », « Les deux formes .jar et .jar.disabled sont supprimées. » ; erreurs : « Tapez au moins 2 caractères. », « Nom de fichier refusé : lettres, chiffres, points, tirets, espaces et extension .jar seulement. », « Les jars sont limités à 100 Mo. », « L'envoi a été interrompu. », « Ce fichier n'est pas une archive jar valide. », « Ce jar n'est pas un mod pour le loader du serveur (détecté : {{detected}}). », « Un fichier de ce nom existe déjà. », « Ce fichier est géré par Modrinth : retirez-le de la liste à la place. », « Ce mod est déjà fourni par {{other}}. »

Run: `node packages/frontend/scripts/merge-i18n.mjs`
Expected: parité OK.

`mods-errors.ts` : ajouter les neuf codes à `CODES` et passer `details` à la traduction :

```ts
export function describeModsError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  const details = e.response?.data?.details;
  if (code && CODES.has(code)) return t(`mods.errors.${code}`, { detected: details ?? '?', other: details ?? '?' });
  return e.response?.data?.error ?? t('shared.error');
}
```

(`ApiError` gagne `details?: string`.)

- [ ] **Step 3 : tests de page pour la recherche**

Dans `Mods.test.tsx`, étendre le mock : `search: vi.fn(), upload: vi.fn(), deleteFile: vi.fn()`. Remplacer le test « adds a mod and shows the translated error code on failure » par :

```ts
  it('searches Modrinth after a short pause, adds from a result and marks listed ones', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    vi.mocked(modsApi.search).mockResolvedValue({ loader: 'fabric', gameVersion: '1.21.1', hits: [
      { slug: 'xaeros-minimap', projectId: '1', title: "Xaero's Minimap", description: 'A minimap.', iconUrl: null, author: 'xaero96', downloads: 12345678, follows: 1, latestVersion: '24.2', alreadyListed: false },
      { slug: 'fabric-api', projectId: '2', title: 'Fabric API', description: null, iconUrl: null, author: null, downloads: 0, follows: 0, latestVersion: null, alreadyListed: true },
    ] });
    vi.mocked(modsApi.add).mockResolvedValue(base);
    await screen.findByText('custom.jar');
    const input = screen.getByPlaceholderText(/Search Modrinth/);
    fireEvent.change(input, { target: { value: 'xa' } });
    expect(modsApi.search).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await waitFor(() => expect(modsApi.search).toHaveBeenCalledWith('xa', expect.anything()));
    expect(await screen.findByText("Xaero's Minimap")).toBeInTheDocument();
    expect(screen.getByText('fabric · 1.21.1')).toBeInTheDocument();
    expect(screen.getByText('12.3M downloads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Already listed' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    await waitFor(() => expect(modsApi.add).toHaveBeenCalledWith('xaeros-minimap'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod added'));
    await waitFor(() => expect(screen.queryByText("Xaero's Minimap")).not.toBeInTheDocument()); // panneau fermé
    vi.useRealTimers();
  });

  it('adds a typed slug directly on Enter and shows translated errors', async () => {
    setup();
    await screen.findByText('custom.jar');
    const input = screen.getByPlaceholderText(/Search Modrinth/);
    vi.mocked(modsApi.add).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'loader_mismatch' } } });
    fireEvent.change(input, { target: { value: 'plugin' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(modsApi.add).toHaveBeenCalledWith('plugin'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This project has no version for the server loader.'));
    vi.mocked(modsApi.add).mockResolvedValueOnce(base);
    fireEvent.change(input, { target: { value: 'spark' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod added'));
    expect((input as HTMLInputElement).value).toBe('');
  });
```

(importer `act` depuis `@testing-library/react`.) Le test « is read-only for viewers » vérifie désormais `queryByPlaceholderText(/Search Modrinth/)` absent.

- [ ] **Step 4 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Mods.test.tsx`
Expected: FAIL (placeholder introuvable).

- [ ] **Step 5 : composant de recherche**

`components/mods/ModSearchBox.tsx` :

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, Package, Plus, Search } from 'lucide-react';
import { MODRINTH_ENTRY_RE, type ModrinthSearchHit } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeModsError, type ApiError } from './mods-errors';

const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function ModSearchBox({ onAdd, pending }: { onAdd: (entry: string, reset: () => void) => void; pending: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Debounce 300 ms : la requête ne part qu'après une pause de frappe.
  useEffect(() => { const h = setTimeout(() => setQuery(text.trim()), 300); return () => clearTimeout(h); }, [text]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);
  const enabled = query.length >= 2;
  const { data, isFetching, error } = useQuery({ queryKey: ['mods', 'search', query], queryFn: ({ signal }) => modsApi.search(query, signal), enabled, staleTime: 60_000 });
  const reset = () => { setText(''); setQuery(''); setOpen(false); };
  const submit = (e: FormEvent) => { e.preventDefault(); const v = text.trim(); if (MODRINTH_ENTRY_RE.test(v)) onAdd(v, reset); };
  const add = (h: ModrinthSearchHit) => onAdd(h.slug, reset);
  return (
    <div ref={box} className="relative space-y-1">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={t('mods.search.placeholder')} className="pl-8 font-mono-data" disabled={pending} />
        </div>
        <Button type="submit" size="sm" disabled={pending || !MODRINTH_ENTRY_RE.test(text.trim())}><Plus className="mr-1 h-3.5 w-3.5" />{t('mods.search.add')}</Button>
      </form>
      <p className="text-xs text-muted-foreground">{t('mods.search.hint')}</p>
      {open && enabled && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
          {data && <p className="px-1 pb-2 text-xs text-muted-foreground">{t('mods.search.filter', { loader: data.loader, version: data.gameVersion ?? t('mods.search.unknownVersion') })}</p>}
          {isFetching && !data && <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('mods.search.searching')}</p>}
          {error && <p className="px-1 text-sm text-destructive">{describeModsError(error as ApiError, t)}</p>}
          {data && data.hits.length === 0 && <p className="px-1 text-sm text-muted-foreground">{t('mods.search.none')}</p>}
          {data?.hits.map((h) => (
            <div key={h.slug} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/60">
              {h.iconUrl ? <img src={h.iconUrl} alt="" className="h-8 w-8 rounded" /> : <div className="flex h-8 w-8 items-center justify-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{h.title}{h.author && <span className="ml-2 text-xs font-normal text-muted-foreground">{h.author}</span>}</p>
                {h.description && <p className="truncate text-xs text-muted-foreground" title={h.description}>{h.description}</p>}
                <p className="text-xs text-muted-foreground">{t('mods.search.downloads', { n: compact(h.downloads) })}</p>
              </div>
              <Button size="sm" variant={h.alreadyListed ? 'outline' : 'default'} disabled={pending || h.alreadyListed} onClick={() => add(h)}>{h.alreadyListed ? t('mods.search.listed') : t('mods.search.add')}</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note i18n : `downloads` est passé déjà formaté (« 12.3M ») sous le nom `n`, pas `count`, pour éviter la pluralisation automatique d'i18next.

Dans `ModrinthList.tsx`, remplacer l'import et l'usage de `AddModForm` par `ModSearchBox` (mêmes props), supprimer `AddModForm.tsx`.

- [ ] **Step 6 : tests, typecheck, lint**

Run: `pnpm --filter @mc/frontend exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS. Si le test avec faux timers est instable, remplacer `vi.useFakeTimers` par un `waitFor` réel de 400 ms (`await waitFor(() => expect(modsApi.search).toHaveBeenCalled(), { timeout: 1000 })`) et consigner.

- [ ] **Step 7 : commit**

```bash
git add packages/frontend/src packages/frontend/scripts
git commit -m "feat(lot4): recherche dans le catalogue Modrinth depuis la carte des mods

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : frontend, dépôt de jars, suppression, lignes manuelles enrichies

**Files:**
- Create: `packages/frontend/src/components/mods/UploadDropzone.tsx`
- Create: `packages/frontend/src/components/mods/use-mod-upload.ts`
- Modify: `packages/frontend/src/components/mods/ManualList.tsx`
- Modify: `packages/frontend/src/pages/Mods.tsx`
- Test: `packages/frontend/src/pages/Mods.test.tsx`

**Interfaces:**
- Consumes: `modsApi.upload/deleteFile` (tâche 7), `ManualMod.meta` (tâche 1), clés `mods.upload.*`, `mods.manual.delete*`.
- Produces: `useModUpload({ onDone })` → `{ current: { file: File; progress: number } | null; start(file: File, replace?: boolean): void; cancel(): void; pendingReplace: File | null; confirmReplace(): void; dismissReplace(): void }`, `UploadDropzone({ onFiles, disabled })`, `ManualList` avec `onDelete`, `uploading`.

- [ ] **Step 1 : tests de page**

Ajouter dans `Mods.test.tsx` (le `base.manual[0]` gagne `meta: { id: 'custom', name: 'Custom Mod', version: '1.0' }`) :

```ts
  it('uploads a jar with progress, then shows the new view', async () => {
    setup();
    await screen.findByText('Custom Mod');
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'new-mod.jar', { type: 'application/java-archive' });
    vi.mocked(modsApi.upload).mockImplementation(async (_f, opts) => { opts?.onProgress?.(0.5); return { ...base, restartRequired: true, manual: [...base.manual, { file: 'new-mod.jar', enabled: true, size: 4, mtime: '2026-10-11T11:00:00Z', conflict: false, meta: null }] }; });
    const input = screen.getByLabelText(/Drop a .jar file/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(modsApi.upload).toHaveBeenCalledWith(file, expect.objectContaining({ replace: false })));
    expect(await screen.findByText('new-mod.jar')).toBeInTheDocument();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod uploaded'));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
  });

  it('offers to replace an existing file and retries with replace', async () => {
    setup();
    await screen.findByText('Custom Mod');
    const file = new File(['x'], 'custom.jar');
    vi.mocked(modsApi.upload).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'exists' } } }).mockResolvedValueOnce(base);
    fireEvent.change(screen.getByLabelText(/Drop a .jar file/), { target: { files: [file] } });
    expect(await screen.findByText('Replace custom.jar?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.upload).toHaveBeenLastCalledWith(file, expect.objectContaining({ replace: true })));
  });

  it('shows a translated upload error with details', async () => {
    setup();
    await screen.findByText('Custom Mod');
    vi.mocked(modsApi.upload).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'wrong_loader', details: 'paper' } } });
    fireEvent.change(screen.getByLabelText(/Drop a .jar file/), { target: { files: [new File(['x'], 'p.jar')] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This jar is not a mod for the server loader (detected: paper).'));
  });

  it('deletes a manual jar after confirmation and shows name and version', async () => {
    setup();
    expect(await screen.findByText('Custom Mod')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();
    vi.mocked(modsApi.deleteFile).mockResolvedValue({ ...base, manual: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete custom.jar from the server?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.deleteFile).toHaveBeenCalledWith('custom.jar'));
    await waitFor(() => expect(screen.queryByText('Custom Mod')).not.toBeInTheDocument());
  });
```

et dans « is read-only for viewers » : `expect(screen.queryByLabelText(/Drop a .jar file/)).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();`.

- [ ] **Step 2 : lancer pour voir l'échec**

Run: `pnpm --filter @mc/frontend exec vitest run src/pages/Mods.test.tsx`
Expected: FAIL (zone de dépôt absente).

- [ ] **Step 3 : hook d'upload**

`components/mods/use-mod-upload.ts` :

```ts
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ModsView } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { describeModsError, type ApiError } from './mods-errors';

/** File d'envoi séquentielle : un fichier à la fois, progression, annulation, proposition de remplacement. */
export function useModUpload(onDone: (view: ModsView) => void) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<{ file: File; progress: number } | null>(null);
  const [pendingReplace, setPendingReplace] = useState<File | null>(null);
  const queue = useRef<{ file: File; replace: boolean }[]>([]);
  const controller = useRef<AbortController | null>(null);

  const run = async () => {
    const next = queue.current.shift();
    if (!next) { setCurrent(null); return; }
    controller.current = new AbortController();
    setCurrent({ file: next.file, progress: 0 });
    try {
      const view = await modsApi.upload(next.file, { replace: next.replace, signal: controller.current.signal, onProgress: (p) => setCurrent({ file: next.file, progress: p }) });
      onDone(view);
      toast.success(t('mods.upload.done'));
    } catch (err) {
      const e = err as ApiError & { code?: string };
      if (e.code === 'ERR_CANCELED') { /* annulé par l'utilisateur */ }
      else if (!next.replace && (e.response?.data?.code === 'exists' || (e.response?.data?.code === 'duplicate_mod' && e.response?.data?.details === next.file.name))) setPendingReplace(next.file);
      else toast.error(describeModsError(e, t));
    }
    void run();
  };
  const start = (file: File, replace = false) => { queue.current.push({ file, replace }); if (!current) void run(); };
  const cancel = () => controller.current?.abort();
  const confirmReplace = () => { const f = pendingReplace; setPendingReplace(null); if (f) start(f, true); };
  const dismissReplace = () => setPendingReplace(null);
  return { current, start, cancel, pendingReplace, confirmReplace, dismissReplace };
}
```

- [ ] **Step 4 : zone de dépôt et liste manuelle**

`components/mods/UploadDropzone.tsx` :

```tsx
import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export function UploadDropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = (list: FileList | null) => { const files = Array.from(list ?? []).filter((f) => f.name.toLowerCase().endsWith('.jar')); if (files.length) onFiles(files); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) accept(e.dataTransfer.files); };
  return (
    <label htmlFor={id} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground transition-colors', over ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40', disabled && 'pointer-events-none opacity-60')}>
      <Upload className="h-4 w-4" />
      <span>{t('mods.upload.drop')}</span>
      <input id={id} ref={input} type="file" accept=".jar" multiple className="sr-only" disabled={disabled} onChange={(e) => { accept(e.target.files); e.target.value = ''; }} />
    </label>
  );
}
```

`ManualList.tsx` : nouvelles props `onDelete: (file: string) => void`, `upload: { current: { file: File; progress: number } | null; onFiles: (files: File[]) => void; onCancel: () => void }`. En tête du `CardContent` (admin) : `<UploadDropzone onFiles={upload.onFiles} disabled={pending} />`, puis si `upload.current` : une ligne provisoire

```tsx
<div className="flex items-center gap-3 rounded-md border border-dashed border-border p-2">
  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  <div className="min-w-0 flex-1">
    <p className="truncate font-mono-data text-sm">{upload.current.file.name}</p>
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(upload.current.progress * 100)}%` }} /></div>
  </div>
  <Button size="sm" variant="ghost" onClick={upload.onCancel}>{t('mods.upload.cancel')}</Button>
</div>
```

Chaque ligne existante : titre = `m.meta?.name ?? m.file`, suivi de `m.meta?.version` en `Badge variant="outline"` quand connu, puis le nom de fichier en mono dessous quand `meta?.name` existe (sinon la taille seule comme aujourd'hui) ; après le `Switch`, un bouton corbeille `aria-label={t('mods.manual.delete')}` ouvrant un `ConfirmDialog` (`title: t('mods.manual.deleteTitle', { file })`, `description: m.conflict ? t('mods.manual.deleteConflictDescription') : t('mods.manual.deleteDescription')`, `destructive`). Le `Switch` reste désactivé en cas de conflit, la corbeille non.

- [ ] **Step 5 : page**

Dans `Mods.tsx` : `const upload = useModUpload(replace);` ; mutation `deleteFile` (`modsApi.deleteFile`, `onSuccess: replace`, `onError`) ; `pending` inclut `upload.current !== null` ; `ManualList` reçoit `onDelete={(f) => deleteFile.mutate(f)}` et `upload={{ current: upload.current, onFiles: (files) => files.forEach((f) => upload.start(f)), onCancel: upload.cancel }}` ; un `ConfirmDialog` global `open={upload.pendingReplace !== null}` avec `title={t('mods.upload.replaceTitle', { file: upload.pendingReplace?.name ?? '' })}`, `description={t('mods.upload.replaceDescription')}`, `onConfirm={upload.confirmReplace}`, `onOpenChange={(o) => { if (!o) upload.dismissReplace(); }}`.

- [ ] **Step 6 : tests, typecheck, lint**

Run: `pnpm --filter @mc/frontend exec vitest run && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7 : commit**

```bash
git add packages/frontend/src
git commit -m "feat(lot4): dépôt de jars par glisser-déposer avec progression, suppression et métadonnées des jars manuels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : documentation et chaîne CI

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1 : README**

Section `## Mods`, ajouter après le point « Manual jars » :

```markdown
- **Catalogue**: the search box of the Modrinth card queries Modrinth through the backend (filtered on the server loader and, when known, the running Minecraft version) and adds a result with one click; typing a slug and pressing Enter still works.
- **Upload**: drop a `.jar` on the Manual jars card. The backend streams it to a temporary file, checks that it is a valid archive carrying the descriptor of the server loader (`fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`, `plugin.yml`, `paper-plugin.yml`), reads its id, name and version, refuses duplicates (same file name unless you choose to replace, same mod id in another file, or a file managed by Modrinth) and moves it into the folder. Limit: 100 MB (nginx and backend). Manual jars can be deleted from the page; Modrinth-managed ones cannot.
```

Section `## Privacy`, compléter le paragraphe Mods : « The catalogue search is also relayed by the backend: only the search text, the server loader and the Minecraft version are sent to `api.modrinth.com`. »

- [ ] **Step 2 : CLAUDE.md**

Dans le point « Mods (lot 3) », ajouter une phrase : « Lot 4 : `search()` relaie `/v2/search` (facettes loader + version, cache 60 s, `alreadyListed`) ; `upload()` streame le corps brut dans `mc-manager/tmp/<uuid>.part` (limite `MAX_UPLOAD_BYTES`, `Content-Length` puis compteur), `jar-inspector.ts` (`yauzl`, descripteurs Fabric/Quilt/Forge/NeoForge/Paper, 1 Mo max par descripteur, jamais d'extraction) puis `rename` sous verrou ; `deleteFile()` ne touche que les jars manuels ; `start()` purge les `.part`. `ManualMod.meta` vient de l'inspecteur avec cache par taille et mtime. nginx : `location = /api/mods/upload` à 100 Mo. »

Dans les invariants, remplacer la parenthèse sur les écritures mods par : « fichier `mc-manager/modrinth-projects.txt`, renommages `.jar` ⇄ `.jar.disabled` dans `mods/` ou `plugins/`, dépôt d'un jar vérifié dans ce dossier via `mc-manager/tmp/`, suppression d'un jar manuel ; jamais un jar présent dans `files` du manifeste, jamais d'extraction du contenu d'une archive ».

- [ ] **Step 3 : chaîne CI complète**

Run: `pnpm db:generate && pnpm --filter @mc/common run build && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tout vert.

- [ ] **Step 4 : commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(lot4): catalogue Modrinth et dépôt de jars

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
