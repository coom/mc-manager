import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { BackupService, isSafeBackupName } from './backup-service.js';
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
    await p; await wait(5);
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
});
