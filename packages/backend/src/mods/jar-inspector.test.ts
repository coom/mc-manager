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
