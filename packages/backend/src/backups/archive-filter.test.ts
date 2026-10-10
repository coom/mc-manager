import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync, linkSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import * as tar from 'tar';
import { normalizeEntryPath, validateEntry, isGzipFile, inspectArchive, restoreArchive, openArchive, globToRegExp, removeExcept, DEFAULT_EXCLUDES, RESTORE_MARKER } from './archive-filter.js';
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

  it('rejects a symbolic link entry at inspection', async (ctx) => {
    const lsrc = path.join(root, 'lsrc'); mkdirSync(path.join(lsrc, 'world'), { recursive: true });
    writeFileSync(path.join(lsrc, 'world', 'level.dat'), 'L');
    try { symlinkSync('/etc/passwd', path.join(lsrc, 'world', 'evil')); } catch { ctx.skip(); return; }
    const bad = path.join(root, 'symlink.tgz');
    await tar.create({ gzip: true, cwd: lsrc, file: bad }, ['.']);
    await expect(inspectArchive(bad)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/SymbolicLink/) });
    await expect(restoreArchive(bad, data, () => undefined)).rejects.toMatchObject({ statusCode: 400 });
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('LEVEL-CURRENT');
  });

  it('rejects a hard link entry at inspection', async () => {
    const lsrc = path.join(root, 'hsrc'); mkdirSync(path.join(lsrc, 'world'), { recursive: true });
    writeFileSync(path.join(lsrc, 'world', 'a.dat'), 'A');
    linkSync(path.join(lsrc, 'world', 'a.dat'), path.join(lsrc, 'world', 'b.dat'));
    const bad = path.join(root, 'hardlink.tgz');
    await tar.create({ gzip: true, cwd: lsrc, file: bad }, ['.']);
    await expect(inspectArchive(bad)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/type Link/) });
  });

  it('keeps reading from the held descriptor after the archive is unlinked (mc-backup prune)', async () => {
    const h = await openArchive(file);
    try {
      const info = await h.inspect();
      unlinkSync(file);
      expect(existsSync(file)).toBe(false);
      await restoreArchive(h, data, () => undefined, { excludes: DEFAULT_EXCLUDES, info });
    } finally { await h.close(); }
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('LEVEL-BACKUP');
  });

  it('ignores a restore marker contained in an archive', async () => {
    writeFileSync(path.join(src, RESTORE_MARKER), '{"archive":"old"}');
    const withMarker = path.join(root, 'marker.tgz');
    await tar.create({ gzip: true, cwd: src, file: withMarker }, ['.']);
    writeFileSync(path.join(data, RESTORE_MARKER), 'CURRENT-MARKER');
    expect((await inspectArchive(withMarker)).topLevel).not.toContain(RESTORE_MARKER);
    await restoreArchive(withMarker, data, () => undefined);
    expect(readFileSync(path.join(data, RESTORE_MARKER), 'utf8')).toBe('CURRENT-MARKER');
  });
});

describe('globToRegExp', () => {
  it.each([
    ['*.jar', 'EssentialsX.jar', true], ['*.jar', 'EssentialsX.jar.bak', false], ['*.jar', 'x.JAR', false],
    ['cache', 'cache', true], ['cache', 'cache2', false], ['logs', 'xlogs', false],
    ['*.tmp', '.tmp', true], ['a?c', 'abc', true], ['a?c', 'ac', false],
    ['a.b', 'axb', false], ['[x]+(y)', '[x]+(y)', true], ['*', 'anything', true],
  ])('%s matches %s: %s', (pattern, name, expected) => expect(globToRegExp(pattern).test(name)).toBe(expected));
});

describe('exclusion-aware replace (mc-backup EXCLUDES)', () => {
  let root: string; let src: string; let data: string; let file: string;
  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'mc-excl-'));
    src = path.join(root, 'src'); data = path.join(root, 'data'); file = path.join(root, 'world-20261010-110000.tgz');
    // Archive telle que mc-backup la produit avec EXCLUDES=*.jar,cache,logs,*.tmp : dossiers gardés, jars absents.
    mkdirSync(path.join(src, 'plugins', 'EssentialsX'), { recursive: true });
    mkdirSync(path.join(src, 'world'), { recursive: true });
    writeFileSync(path.join(src, 'plugins', 'EssentialsX', 'config.yml'), 'NEW-CONFIG');
    writeFileSync(path.join(src, 'plugins', 'other.yml'), 'OTHER');
    writeFileSync(path.join(src, 'world', 'level.dat'), 'LEVEL-BACKUP');
    await tar.create({ gzip: true, cwd: src, file }, ['.']);
    mkdirSync(path.join(data, 'plugins', 'EssentialsX', 'logs'), { recursive: true });
    mkdirSync(path.join(data, 'plugins', 'EssentialsX', 'cache'), { recursive: true });
    mkdirSync(path.join(data, 'plugins', 'old-plugin'), { recursive: true });
    mkdirSync(path.join(data, 'world', 'region'), { recursive: true });
    writeFileSync(path.join(data, 'plugins', 'EssentialsX.jar'), 'JAR');
    writeFileSync(path.join(data, 'plugins', 'EssentialsX', 'config.yml'), 'OLD-CONFIG');
    writeFileSync(path.join(data, 'plugins', 'EssentialsX', 'logs', 'a.log'), 'LOG');
    writeFileSync(path.join(data, 'plugins', 'EssentialsX', 'cache', 'c.bin'), 'CACHE');
    writeFileSync(path.join(data, 'plugins', 'EssentialsX', 'x.tmp'), 'TMP');
    writeFileSync(path.join(data, 'plugins', 'old-plugin', 'stale.yml'), 'STALE');
    writeFileSync(path.join(data, 'world', 'level.dat'), 'LEVEL-CURRENT');
    writeFileSync(path.join(data, 'world', 'region', 'r.9.9.mca'), 'NEWER');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps plugin jars, logs, cache and tmp files, replaces the rest of each top-level entry', async () => {
    await restoreArchive(file, data, () => undefined, { excludes: DEFAULT_EXCLUDES });
    expect(readFileSync(path.join(data, 'plugins', 'EssentialsX.jar'), 'utf8')).toBe('JAR');
    expect(readFileSync(path.join(data, 'plugins', 'EssentialsX', 'config.yml'), 'utf8')).toBe('NEW-CONFIG');
    expect(readFileSync(path.join(data, 'plugins', 'other.yml'), 'utf8')).toBe('OTHER');
    expect(existsSync(path.join(data, 'plugins', 'old-plugin'))).toBe(false);
    expect(readFileSync(path.join(data, 'plugins', 'EssentialsX', 'logs', 'a.log'), 'utf8')).toBe('LOG');
    expect(readFileSync(path.join(data, 'plugins', 'EssentialsX', 'cache', 'c.bin'), 'utf8')).toBe('CACHE');
    expect(readFileSync(path.join(data, 'plugins', 'EssentialsX', 'x.tmp'), 'utf8')).toBe('TMP');
    // world n'a aucun fichier exclu : remplacé comme avant.
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('LEVEL-BACKUP');
    expect(existsSync(path.join(data, 'world', 'region'))).toBe(false);
  });

  it('with an empty exclusion list, replaces top-level entries entirely', async () => {
    await restoreArchive(file, data, () => undefined, { excludes: [] });
    expect(existsSync(path.join(data, 'plugins', 'EssentialsX.jar'))).toBe(false);
    expect(existsSync(path.join(data, 'plugins', 'EssentialsX', 'logs'))).toBe(false);
    expect(readFileSync(path.join(data, 'plugins', 'EssentialsX', 'config.yml'), 'utf8')).toBe('NEW-CONFIG');
  });

  it('removeExcept: a matching target is kept, a missing one is a no-op, a plain one is removed', async () => {
    expect(await removeExcept(path.join(data, 'plugins', 'EssentialsX.jar'), ['*.jar'])).toBe(true);
    expect(existsSync(path.join(data, 'plugins', 'EssentialsX.jar'))).toBe(true);
    expect(await removeExcept(path.join(data, 'plugins', 'EssentialsX.jar'), [])).toBe(false);
    expect(existsSync(path.join(data, 'plugins', 'EssentialsX.jar'))).toBe(false);
    expect(await removeExcept(path.join(data, 'nope'), ['*.jar'])).toBe(false);
    expect(await removeExcept(path.join(data, 'world'), ['*.jar'])).toBe(false);
    expect(existsSync(path.join(data, 'world'))).toBe(false);
  });
});
