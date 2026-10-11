import { describe, it, expect, afterAll, vi } from 'vitest';
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

// Au niveau du module comme les autres tests du dépôt : le db push de la base temporaire dépasse parfois le timeout d'un hook sous charge.
const prisma: PrismaClient = testPrisma();
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
      listing: '# my header\nfabric-api\nlithium:0.14.0\n# spark\nbad entry\n',
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
    expect(v.unmanagedLines).toEqual([{ raw: '# my header', invalid: false }, { raw: 'bad entry', invalid: true }]);
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
