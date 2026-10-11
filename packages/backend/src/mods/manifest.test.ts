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
