import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, utimes } from 'fs/promises';

// stat est espionné pour simuler un jar supprimé entre readdir et stat (l'image retélécharge au démarrage).
vi.mock('fs/promises', async (importOriginal) => { const m = await importOriginal<typeof import('fs/promises')>(); return { ...m, stat: vi.fn(m.stat) }; });
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
import { Readable } from 'stream';
import { MAX_UPLOAD_BYTES } from '@mc/common';
import { writeZip } from './test-zip.js';

// Au niveau du module comme les autres tests du dépôt : le db push de la base temporaire dépasse parfois le timeout d'un hook sous charge.
const prisma: PrismaClient = testPrisma();
afterAll(async () => { await prisma.$disconnect(); });

const LISTING = 'mc-manager/modrinth-projects.txt';

async function setup(opts: { env?: string[]; startedAt?: string | null; listing?: string; manifest?: object; mods?: Record<string, string>; noContainer?: boolean; gameVersion?: string | null } = {}) {
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
  const svc = new ModsService({ dataDir, docker, modrinth, prisma, lock, broadcast: (m) => sent.push(m), gameVersion: () => opts.gameVersion ?? null });
  return { dataDir, svc, modrinth, sent, lock, docker, listing: () => readFile(path.join(dataDir, LISTING), 'utf8'), modsDir: () => readdir(path.join(dataDir, 'mods')) };
}

describe('ModsService.view', () => {
  it('reports a missing container as unsupported with source none, without throwing', async () => {
    const { svc } = await setup({ noContainer: true });
    const v = await svc.view();
    expect(v.server).toBeNull();
    expect(v.serverIssue).toBe('unavailable');
    expect(v.source).toBe('none');
    expect(v.modrinth).toEqual([]);
    expect(v.manual).toEqual([]);
    expect(v.restartRequired).toBe(false);
  });
  it('reports a vanilla server as unsupported but still lists the file', async () => {
    const { svc } = await setup({ env: ['TYPE=VANILLA'], listing: 'lithium\n' });
    const v = await svc.view();
    expect(v.server).toBeNull();
    expect(v.serverIssue).toBe('unsupported');
    expect(v.modrinth.map((m) => m.entry)).toEqual(['lithium']);
    const { svc: ok } = await setup({ listing: 'lithium\n' });
    expect((await ok.view()).serverIssue).toBeNull();
  });
  it('skips a jar removed between readdir and stat instead of failing the view', async () => {
    const { svc } = await setup({ listing: '', mods: { 'a.jar': 'a', 'b.jar': 'b' } });
    vi.mocked(stat).mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    const v = await svc.view();
    expect(v.manual.map((m) => m.file)).toEqual(['b.jar']);
  });
  it('aggregates listing, manifest, cache and the mods folder', async () => {
    await prisma.modrinthProject.create({ data: { slug: 'lithium', projectId: 'gvQqBUqZ', title: 'Lithium', description: 'Optimizes the game.', iconUrl: 'https://cdn.modrinth.com/l.png', fetchedAt: new Date() } });
    const { svc, modrinth } = await setup({
      listing: '# my header\nfabric-api\nlithium:0.14.0\n# spark\nbad entry\n',
      manifest: { files: ['mods/fabric-api.jar', 'mods/lithium.jar'], projects: ['fabric-api', 'lithium:0.14.0'] },
      mods: { 'fabric-api.jar': 'a', 'lithium.jar': 'b', 'custom.jar': 'c', 'old.jar.disabled': 'd', 'notes.txt': 'e' },
    });
    modrinth.add({ slug: 'fabric-api', title: 'Fabric API', description: 'Core API for Fabric mods.' });
    const v = await svc.view();
    expect(v.server).toEqual({ loader: 'fabric', dir: 'mods' });
    expect(v.source).toBe('file');
    expect(v.listingExists).toBe(true);
    expect(v.composeLine).toBe('MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"');
    expect(v.modrinth).toEqual([
      { entry: 'fabric-api', slug: 'fabric-api', enabled: true, installed: true, title: null, description: null, iconUrl: null, projectId: null },
      { entry: 'lithium:0.14.0', slug: 'lithium', enabled: true, installed: true, title: 'Lithium', description: 'Optimizes the game.', iconUrl: 'https://cdn.modrinth.com/l.png', projectId: 'gvQqBUqZ' },
      { entry: 'spark', slug: 'spark', enabled: false, installed: false, title: null, description: null, iconUrl: null, projectId: null },
    ]);
    expect(v.unmanagedLines).toEqual([{ raw: '# my header', invalid: false }, { raw: 'bad entry', invalid: true }]);
    expect(v.manual.map((m) => [m.file, m.enabled, m.conflict])).toEqual([['custom.jar', true, false], ['old.jar', false, false]]);
    expect(v.manual[0].size).toBe(1);
    expect(v.restartRequired).toBe(false);
    // Résolution en arrière-plan des entrées sans cache : fabric-api et spark, une seule fois.
    await svc.pendingResolution;
    expect(modrinth.calls.sort()).toEqual(['fabric-api', 'spark']);
    const v2 = await svc.view();
    expect(v2.modrinth[0].title).toBe('Fabric API');
    expect(v2.modrinth[0].description).toBe('Core API for Fabric mods.');
    await svc.pendingResolution;
    expect(modrinth.calls.length).toBe(2); // spark inconnu : pas de nouvelle tentative avant une heure
  });
  it('re-resolves a cached project that has no description yet (rows cached before the field existed)', async () => {
    await prisma.modrinthProject.create({ data: { slug: 'krypton', projectId: 'fQEb0iXm', title: 'Krypton', description: null, iconUrl: null, fetchedAt: new Date() } });
    const { svc, modrinth } = await setup({ listing: 'krypton\n' });
    modrinth.add({ slug: 'krypton', title: 'Krypton', description: 'Optimizes the networking stack.' });
    expect((await svc.view()).modrinth[0].description).toBeNull();
    await svc.pendingResolution;
    expect(modrinth.calls).toEqual(['krypton']);
    expect((await svc.view()).modrinth[0].description).toBe('Optimizes the networking stack.');
    await svc.pendingResolution;
    expect(modrinth.calls.length).toBe(1); // une fois renseignée, plus d'appel
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
    // Tant que MODRINTH_PROJECTS ne pointe pas sur notre fichier, un redémarrage n'appliquerait rien : pas de bandeau.
    const { svc: svc5 } = await setup({ env: ['TYPE=FABRIC', 'MODRINTH_PROJECTS=fabric-api'], listing: 'lithium\n' });
    expect((await svc5.view()).restartRequired).toBe(false);
  });
  describe('listing-file mode (manifest.projects holds the raw @file reference)', () => {
    const LISTING_REF = '@/data/mc-manager/modrinth-projects.txt';
    // Dates dans le passé : un fichier réécrit par le test (mtime = maintenant) doit être plus récent que le manifeste.
    const manifestAt = '2026-01-01T10:00:00Z';
    const ageListing = (dataDir: string) => utimes(path.join(dataDir, LISTING), new Date('2026-01-01T09:00:00Z'), new Date('2026-01-01T09:00:00Z'));

    it('treats a manifest newer than the listing file as applied: enabled entries installed, no restart', async () => {
      const { svc, dataDir } = await setup({ listing: 'lithium\n# spark\n', manifest: { timestamp: manifestAt, files: ['mods/lithium-fabric-0.14.0.jar'], projects: [LISTING_REF] } });
      await ageListing(dataDir);
      const v = await svc.view();
      expect(v.modrinth.map((m) => [m.slug, m.enabled, m.installed])).toEqual([['lithium', true, true], ['spark', false, false]]);
      expect(v.restartRequired).toBe(false);
    });
    it('after a change, remembers what the last start applied and asks for a restart', async () => {
      const { svc, dataDir } = await setup({ listing: 'lithium\n# spark\n', manifest: { timestamp: manifestAt, files: [], projects: [LISTING_REF] } });
      await ageListing(dataDir);
      await svc.view(); // observe l'état appliqué
      await svc.setEnabled('spark', true); // le fichier devient plus récent que le manifeste
      const v = await svc.view();
      expect(v.modrinth.map((m) => [m.slug, m.enabled, m.installed])).toEqual([['lithium', true, true], ['spark', true, false]]);
      expect(v.restartRequired).toBe(true);
      // Le snapshot survit à un redémarrage du backend (stocké en base, pas en mémoire).
      const again = new ModsService({ ...(svc as unknown as { deps: ConstructorParameters<typeof ModsService>[0] }).deps });
      expect((await again.view()).modrinth.map((m) => m.installed)).toEqual([true, false]);
    });
    it('without any observed applied state, pending entries are reported as not installed', async () => {
      const { svc } = await setup({ listing: 'lithium\n', manifest: { timestamp: manifestAt, files: [], projects: [LISTING_REF] } });
      // listing écrit maintenant → plus récent que le manifeste, et aucun snapshot en base (clé AppSetting mods.appliedSlugs)
      await prisma.appSetting.deleteMany({ where: { key: 'mods.appliedSlugs' } });
      const v = await svc.view();
      expect(v.modrinth[0].installed).toBe(false);
      expect(v.restartRequired).toBe(true);
    });
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
    const { svc, listing, sent } = await setup({ listing: '# my header\nfabric-api\n# lithium\nbad entry\n' });
    await svc.setEnabled('lithium', true);
    expect(await listing()).toBe('# my header\nfabric-api\nlithium\nbad entry\n');
    await svc.setEnabled('fabric-api', false);
    expect(await listing()).toBe('# my header\n# fabric-api\nlithium\nbad entry\n');
    await svc.setEnabled('lithium', true); // déjà actif : pas d'écriture ni de broadcast
    expect(sent.length).toBe(2);
    await svc.remove('lithium');
    expect(await listing()).toBe('# my header\n# fabric-api\nbad entry\n');
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

async function fabricJar(id = 'xaeros', name = "Xaero's", version = '24.2'): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mc-up-'));
  const f = path.join(dir, 'x.jar');
  await writeZip(f, { 'fabric.mod.json': JSON.stringify({ id, name, version }), 'a/B.class': 'x' });
  return readFile(f);
}
const up = (svc: ModsService, buf: Buffer, name = 'xaeros.jar', replace = false, declaredSize = buf.length) => svc.upload({ name, replace, declaredSize, body: Readable.from(buf) });
const parts = (dataDir: string) => readdir(path.join(dataDir, 'mc-manager', 'tmp')).catch(() => [] as string[]);

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
    const { svc, modsDir, dataDir } = await setup({ listing: 'lithium\n', manifest: { files: ['mods/lithium.jar'], projects: ['lithium'] }, mods: { 'lithium.jar': 'managed' } });
    expect(await codeOf(up(svc, await fabricJar('lithium'), 'lithium.jar', true))).toEqual([409, 'managed']);
    expect(await readFile(path.join(dataDir, 'mods', 'lithium.jar'), 'utf8')).toBe('managed');
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
