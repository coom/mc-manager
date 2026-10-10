import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import * as tar from 'tar';
import { RestoreService } from './restore-service.js';
import { BackupService } from './backup-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (pred: () => boolean, ms = 2000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(5); } };

describe('RestoreService', () => {
  let root: string; let data: string; let backups: string; let archive: string;
  let docker: FakeDocker; let mc: FakeContainer; let mcBackup: FakeContainer; let svc: DockerService;
  let backupSvc: BackupService; let lock: DataLock; let events: unknown[]; let audits: string[];

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'mc-restore-'));
    data = path.join(root, 'data'); backups = path.join(root, 'backups');
    mkdirSync(path.join(data, 'world'), { recursive: true }); mkdirSync(backups);
    writeFileSync(path.join(data, 'world', 'level.dat'), 'CURRENT');
    const src = path.join(root, 'src'); mkdirSync(path.join(src, 'world'), { recursive: true });
    writeFileSync(path.join(src, 'world', 'level.dat'), 'BACKUP');
    archive = path.join(backups, 'world-20261010-100000.tgz');
    await tar.create({ gzip: true, cwd: src, file: archive }, ['.']);
    docker = new FakeDocker();
    mc = new FakeContainer(inspectFixture());
    mcBackup = new FakeContainer(inspectFixture(), undefined, new PassThrough(), new PassThrough(), 0);
    docker.containers.set('mc', mc); docker.containers.set('mc-backup', mcBackup);
    svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    lock = new DataLock();
    backupSvc = new BackupService(backups, svc, lock);
    events = []; audits = [];
  });
  afterEach(() => { svc.stop(); rmSync(root, { recursive: true, force: true }); });

  function service(over: { stopTimeoutMs?: number } = {}) {
    const r = new RestoreService({ dataDir: data, backups: backupSvc, docker: svc, stopTimeoutMs: over.stopTimeoutMs ?? 2000 });
    r.on('progress', (e) => events.push({ progress: e }));
    r.on('done', (e) => events.push({ done: e }));
    return r;
  }
  const auditFn = async (d: string) => { audits.push(d); };
  /** Simule un `stop` du conteneur : le fake passe à exited et émet l'événement Docker. */
  function stopSucceeds() {
    mc.stop = async (o: { t: number }) => { mc.calls.push(`stop:${o.t}`); mc.state = inspectFixture({ Status: 'exited', Running: false }); docker.emitEvent({ Action: 'die', name: 'mc' }); };
  }
  function safetyBackupSucceeds() {
    // runNow lit la sortie du conteneur mc-backup ; on la termine tout de suite et on dépose la nouvelle archive.
    mcBackup.exec = async () => {
      writeFileSync(path.join(backups, 'world-20261010-120000.tgz'), 'x');
      const s = new PassThrough(); s.end('Backup done\n');
      return { start: async () => s as never, inspect: async () => ({ ExitCode: 0, Running: false }) };
    };
  }

  it('runs the full happy path: safety backup, stop, replace, extract, start, done', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    expect(r.status()).toMatchObject({ running: true });
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(true);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
    expect(mc.calls).toEqual(['stop:60', 'start']);
    const steps = events.filter((e) => 'progress' in (e as object)).map((e) => (e as { progress: { step: string } }).progress.step);
    expect([...new Set(steps)]).toEqual(['check', 'safety', 'stop', 'replace', 'extract', 'start']);
    expect(audits).toEqual(['world-20261010-100000.tgz', 'exit ok']);
    expect(r.status()).toEqual({ running: false, step: null });
    expect(lock.busy).toBeNull();
  });

  it('does not start the server when startAfter is false', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: false, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(mc.calls).toEqual(['stop:60']);
  });

  it('refuses before 202 when the archive is unknown, not gzip, or the lock is held', async () => {
    const r = service();
    await expect(r.restore('nope.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 404 });
    writeFileSync(path.join(backups, 'plain.tgz'), 'plain');
    await expect(r.restore('plain.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 400 });
    const release = lock.acquire('backup');
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    release();
    expect(audits).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
  });

  it('with the server stopped, requires confirmNoSafetyBackup and then skips the safety step', async () => {
    mc.state = inspectFixture({ Status: 'exited', Running: false });
    await svc.refresh();
    const r = service();
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: false, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    await r.restore('world-20261010-100000.tgz', { startAfter: false, confirmNoSafetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; safetyBackup: string | null } }).done;
    expect(done).toMatchObject({ ok: true, safetyBackup: null });
    expect(mc.calls).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('aborts without touching data when the safety backup fails', async () => {
    stopSucceeds();
    mcBackup.exec = async () => { const s = new PassThrough(); s.end('boom\n'); return { start: async () => s as never, inspect: async () => ({ ExitCode: 2, Running: false }) }; };
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/safety backup/i);
    expect(mc.calls).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(audits).toEqual(['world-20261010-100000.tgz', expect.stringMatching(/^failed: /)]);
    expect(lock.busy).toBeNull();
  });

  it('aborts without touching data when the server does not stop in time', async () => {
    safetyBackupSucceeds();
    mc.stop = async (o: { t: number }) => { mc.calls.push(`stop:${o.t}`); /* le conteneur ne s'arrête jamais */ };
    const r = service({ stopTimeoutMs: 100 });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/did not stop/i);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(mc.calls).toEqual(['stop:60']);
  });

  it('reports a partial state with the safety backup name when extraction fails, and does not restart', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    // L'archive devient illisible après le check : on la tronque juste avant l'extraction.
    const r = service();
    r.on('progress', (e: { step: string }) => { if (e.step === 'replace') writeFileSync(archive, Buffer.from([0x1f, 0x8b, 0x08, 0x00])); });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/partial/i);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(mc.calls).toEqual(['stop:60']);
    expect(existsSync(path.join(data, 'world', 'level.dat'))).toBe(false);
  });

  it('still reports success when the audit callback rejects every time', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, async () => { throw new Error('audit down'); });
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean } }).done;
    expect(done.ok).toBe(true);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('emits done exactly once and releases the lock when a done listener throws', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    r.on('done', () => { throw new Error('listener boom'); });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    await wait(50);
    expect(events.filter((e) => 'done' in (e as object))).toHaveLength(1);
    expect(lock.busy).toBeNull();
    expect(r.status().running).toBe(false);
  });

  it('leaves no stuck step when the lock is taken between the check and the acquire', async () => {
    const r = service();
    backupSvc.ensureContainer = async () => { lock.acquire('backup'); };
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    expect(r.status()).toEqual({ running: false, step: null });
    expect(events).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('releases the lock and resets the step when a check progress listener throws', async () => {
    const r = service();
    r.on('progress', () => { throw new Error('listener boom'); });
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn)).rejects.toThrow('listener boom');
    expect(lock.busy).toBeNull();
    expect(r.status().running).toBe(false);
  });

  it('fails fast when the stop request itself is rejected', async () => {
    safetyBackupSucceeds();
    mc.stop = async () => { throw new Error('docker refused'); };
    const r = service({ stopTimeoutMs: 5000 });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/stop request failed/);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
  });

  it('holds the data lock for the whole run so a manual backup gets 409 meanwhile', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, confirmNoSafetyBackup: false }, auditFn);
    await expect(backupSvc.runNow()).rejects.toMatchObject({ statusCode: 409 });
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(lock.busy).toBeNull();
  });
});
