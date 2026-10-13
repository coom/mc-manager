import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { BackupService, isSafeBackupName } from './backup-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('isSafeBackupName', () => {
  it.each(['world-20261010-100000.tgz', 'a.tar.gz'])('accepts %s', (n) => expect(isSafeBackupName(n)).toBe(true));
  it.each(['../x.tgz', 'a/b.tgz', 'a\\b.tgz', '..', 'x.zip', '', '.tgz', 'x.tgz\n', '%2e%2e/x.tgz'])('rejects %j', (n) => expect(isSafeBackupName(n)).toBe(false));
});

describe('BackupService', () => {
  let dir: string; let docker: FakeDocker; let svc: BackupService; let backupContainer: FakeContainer;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-bk-'));
    writeFileSync(path.join(dir, 'world-20261009-100000.tgz'), 'old');
    writeFileSync(path.join(dir, 'world-20261010-100000.tgz'), 'newer!');
    writeFileSync(path.join(dir, 'notes.txt'), 'x');
    mkdirSync(path.join(dir, 'sub.tgz'));
    utimesSync(path.join(dir, 'world-20261009-100000.tgz'), new Date('2026-10-09T10:00:00Z'), new Date('2026-10-09T10:00:00Z'));
    utimesSync(path.join(dir, 'world-20261010-100000.tgz'), new Date('2026-10-10T10:00:00Z'), new Date('2026-10-10T10:00:00Z'));
    docker = new FakeDocker();
    backupContainer = new FakeContainer(inspectFixture(), undefined, new PassThrough(), new PassThrough(), 0);
    docker.containers.set('mc-backup', backupContainer);
    svc = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists only archive files, newest first, with total size', async () => {
    const l = await svc.list();
    expect(l.entries.map((e) => e.name)).toEqual(['world-20261010-100000.tgz', 'world-20261009-100000.tgz']);
    expect(l.totalBytes).toBe(9);
    expect(l.running).toBe(false);
  });

  it('resolve returns the path for an existing archive and 404 otherwise', async () => {
    expect(await svc.resolve('world-20261009-100000.tgz')).toBe(path.join(dir, 'world-20261009-100000.tgz'));
    await expect(svc.resolve('../world-20261009-100000.tgz')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.resolve('missing.tgz')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.resolve('notes.txt')).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.resolve('sub.tgz')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('resolve works with a relative backups dir and returns an absolute path (needed by sendFile)', async () => {
    const rel = path.relative(process.cwd(), dir);
    const relSvc = new BackupService(rel, new DockerService(docker, 'mc', 'mc-backup'));
    const full = await relSvc.resolve('world-20261009-100000.tgz');
    expect(path.isAbsolute(full)).toBe(true);
    expect(full).toBe(path.resolve(dir, 'world-20261009-100000.tgz'));
    await expect(relSvc.resolve('../world-20261009-100000.tgz')).rejects.toMatchObject({ statusCode: 404 });
    await expect(relSvc.resolve('missing.tgz')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('runNow resolves with a non-zero exit code', async () => {
    backupContainer.execExit = 2;
    const p = svc.runNow();
    await wait(5);
    backupContainer.execStream.end();
    expect(await p).toBe(2);
  });

  it('runNow passes the retention of the settings file to backup now', async () => {
    const withDays = new BackupService(dir, new DockerService(docker, 'mc', 'mc-backup'), new DataLock(), async () => 14);
    const p = withDays.runNow();
    await wait(5);
    backupContainer.execStream.end();
    await p;
    expect(backupContainer.execEnvs).toEqual([['PRUNE_BACKUPS_DAYS=14']]);
  });

  it('runNow passes no environment when no retention is managed', async () => {
    const p = svc.runNow();
    await wait(5);
    backupContainer.execStream.end();
    await p;
    expect(backupContainer.execEnvs).toEqual([undefined]);
  });

  it('remove deletes the file', async () => {
    await svc.remove('world-20261009-100000.tgz');
    expect(existsSync(path.join(dir, 'world-20261009-100000.tgz'))).toBe(false);
  });

  it('runNow execs "backup now", streams progress and emits done; a second call is 409', async () => {
    const progress: string[] = []; let done: number | null = null;
    svc.on('progress', (l) => progress.push(l)); svc.on('done', (c) => { done = c; });
    const p = svc.runNow();
    await wait(5);
    expect(svc.isRunning()).toBe(true);
    await expect(svc.runNow()).rejects.toMatchObject({ statusCode: 409 });
    backupContainer.execStream.write('Backing up...\nDone\n');
    backupContainer.execStream.end();
    expect(await p).toBe(0);
    await wait(5);
    expect(backupContainer.calls).toContain('exec:backup now');
    expect(progress).toEqual(['Backing up...', 'Done']);
    expect(done).toBe(0);
    expect(svc.isRunning()).toBe(false);
  });

  it('ensureContainer throws 503 when absent', async () => {
    const bare = new BackupService(dir, new DockerService(new FakeDocker(), 'mc', 'mc-backup'));
    await expect(bare.ensureContainer()).rejects.toMatchObject({ statusCode: 503 });
    await expect(svc.ensureContainer()).resolves.toBeUndefined();
  });

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
});
