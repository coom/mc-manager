import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, stat } from 'fs/promises';
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
    expect(await readManifest(dir)).toEqual({ files: ['mods/lithium-0.14.0.jar', 'mods/spark.jar'], projects: ['lithium', 'spark?'], timestamp: new Date('2026-10-11T00:00:00Z') });
  });
  it('defaults missing arrays to empty and the timestamp to the file mtime', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-manifest-'));
    await writeFile(path.join(dir, MANIFEST_FILE), '{}');
    const m = await readManifest(dir);
    expect(m).toMatchObject({ files: [], projects: [] });
    expect(Math.abs(m!.timestamp.getTime() - (await stat(path.join(dir, MANIFEST_FILE))).mtimeMs)).toBeLessThan(5);
  });
  it('reads the timestamp written by mc-image-helper as epoch seconds or ISO string', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-manifest-'));
    await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ '@type': 'me.itzg.helpers.modrinth.ModrinthManifest', timestamp: 1760180000.5, files: [], projects: ['@/data/mc-manager/modrinth-projects.txt'] }));
    expect((await readManifest(dir))!.timestamp.toISOString()).toBe('2025-10-11T10:53:20.500Z');
    await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ timestamp: '2026-10-11T10:00:00Z', files: [], projects: [] }));
    expect((await readManifest(dir))!.timestamp.toISOString()).toBe('2026-10-11T10:00:00.000Z');
    await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify({ timestamp: 'not a date', files: [], projects: [] }));
    expect(Math.abs((await readManifest(dir))!.timestamp.getTime() - Date.now())).toBeLessThan(5000); // repli sur le mtime
  });
});
