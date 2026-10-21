import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, unlinkSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import * as tar from 'tar';
import { RestoreService, parseExcludes, type RestoreDeps } from './restore-service.js';
import { RESTORE_MARKER } from './archive-filter.js';
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

  function service(over: { stopTimeoutMs?: number; statfs?: RestoreDeps['statfs'] } = {}) {
    const r = new RestoreService({ dataDir: data, backups: backupSvc, docker: svc, stopTimeoutMs: over.stopTimeoutMs ?? 2000, statfs: over.statfs });
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
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    expect(r.status()).toMatchObject({ running: true });
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(true);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
    expect(mc.calls).toEqual(['stop:60', 'start']);
    const steps = events.filter((e) => 'progress' in (e as object)).map((e) => (e as { progress: { step: string } }).progress.step);
    expect([...new Set(steps)]).toEqual(['check', 'safety', 'stop', 'replace', 'extract', 'start']);
    expect(audits).toEqual(['world-20261010-100000.tgz (startAfter=true, safetyBackup=true)', 'exit ok']);
    expect(r.status()).toEqual({ running: false, step: null, interrupted: null });
    expect(existsSync(path.join(data, RESTORE_MARKER))).toBe(false);
    expect(lock.busy).toBeNull();
  });

  it('skips the safety backup on request while the server runs', async () => {
    stopSucceeds();
    const execs: string[] = [];
    mcBackup.exec = async (o: { Cmd: string[] }) => { execs.push(o.Cmd.join(' ')); throw new Error('no backup expected'); };
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; safetyBackup: string | null } }).done;
    expect(done).toMatchObject({ ok: true, safetyBackup: null });
    expect(execs).toEqual([]);
    expect(mc.calls).toEqual(['stop:60', 'start']);
    const steps = events.filter((e) => 'progress' in (e as object)).map((e) => (e as { progress: { step: string } }).progress.step);
    expect(steps).not.toContain('safety');
    expect(audits).toEqual(['world-20261010-100000.tgz (startAfter=true, safetyBackup=false)', 'exit ok']);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('refuses a safety backup before 202 when mc-backup is stopped, and restores without one when unchecked', async () => {
    stopSucceeds();
    mcBackup.state = inspectFixture({ Status: 'exited', Running: false });
    const r = service();
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/backup container is stopped/) });
    expect(audits).toEqual([]);
    expect(lock.busy).toBeNull();
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: false }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('does not start the server when startAfter is false', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(mc.calls).toEqual(['stop:60']);
  });

  it('refuses before 202 when the archive is unknown, not gzip, or the lock is held', async () => {
    const r = service();
    await expect(r.restore('nope.tgz', { startAfter: true, safetyBackup: true }, auditFn)).rejects.toMatchObject({ statusCode: 404 });
    writeFileSync(path.join(backups, 'plain.tgz'), 'plain');
    await expect(r.restore('plain.tgz', { startAfter: true, safetyBackup: true }, auditFn)).rejects.toMatchObject({ statusCode: 400 });
    const release = lock.acquire('backup');
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    release();
    expect(audits).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
  });

  it('with the server stopped, refuses a safety backup and restores without one when unchecked', async () => {
    mc.state = inspectFixture({ Status: 'exited', Running: false });
    await svc.refresh();
    const r = service();
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    await r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: false }, auditFn);
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
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/safety backup/i);
    expect(mc.calls).toEqual([]);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(done.message).toMatch(/^aborted: /);
    expect(audits).toEqual(['world-20261010-100000.tgz (startAfter=true, safetyBackup=true)', expect.stringMatching(/^failed: /)]);
    expect(lock.busy).toBeNull();
  });

  it('aborts without touching data when the server does not stop in time', async () => {
    safetyBackupSucceeds();
    mc.stop = async (o: { t: number }) => { mc.calls.push(`stop:${o.t}`); /* le conteneur ne s'arrête jamais */ };
    const r = service({ stopTimeoutMs: 100 });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/^aborted: server did not stop/i);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    // Rien n'a été touché : relance best effort puisque startAfter.
    expect(mc.calls).toEqual(['stop:60', 'start']);
    expect(existsSync(path.join(data, RESTORE_MARKER))).toBe(false);
  });

  it('reports a partial state with the safety backup name when extraction fails, and does not restart', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    // L'archive devient illisible après le check : on la tronque juste avant l'extraction.
    const r = service();
    r.on('progress', (e: { step: string }) => { if (e.step === 'replace') writeFileSync(archive, Buffer.from([0x1f, 0x8b, 0x08, 0x00])); });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/^partial restore: /);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(mc.calls).toEqual(['stop:60']);
    expect(existsSync(path.join(data, 'world', 'level.dat'))).toBe(false);
    // Le marqueur reste (étape extract) et l'état interrompu est exposé.
    expect(JSON.parse(readFileSync(path.join(data, RESTORE_MARKER), 'utf8'))).toMatchObject({ archive: 'world-20261010-100000.tgz', safetyBackup: 'world-20261010-120000.tgz', step: 'extract' });
    expect(r.status().interrupted).toMatchObject({ archive: 'world-20261010-100000.tgz', safetyBackup: 'world-20261010-120000.tgz' });
  });

  it('still reports success when the audit callback rejects every time', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, async () => { throw new Error('audit down'); });
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean } }).done;
    expect(done.ok).toBe(true);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('emits done exactly once and releases the lock when a done listener throws', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    r.on('done', () => { throw new Error('listener boom'); });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    await wait(50);
    expect(events.filter((e) => 'done' in (e as object))).toHaveLength(1);
    expect(lock.busy).toBeNull();
    expect(r.status().running).toBe(false);
  });

  it('leaves no stuck step when the lock is taken between the check and the acquire', async () => {
    const r = service();
    // Le verrou est pris pendant la vérification de mc-backup, après le assertFree initial.
    const inspect = svc.inspectBackup.bind(svc);
    svc.inspectBackup = async () => { lock.acquire('backup'); return inspect(); };
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn)).rejects.toMatchObject({ statusCode: 409 });
    expect(r.status()).toEqual({ running: false, step: null, interrupted: null });
    expect(events).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('releases the lock and resets the step when a check progress listener throws', async () => {
    const r = service();
    r.on('progress', () => { throw new Error('listener boom'); });
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn)).rejects.toThrow('listener boom');
    expect(lock.busy).toBeNull();
    expect(r.status().running).toBe(false);
  });

  it('fails fast when the stop request itself is rejected', async () => {
    safetyBackupSucceeds();
    mc.stop = async () => { throw new Error('docker refused'); };
    const r = service({ stopTimeoutMs: 5000 });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/^aborted: stop request failed/);
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    await until(() => mc.calls.includes('start'));
  });

  it('does not restart after an aborted restore when startAfter is false', async () => {
    safetyBackupSucceeds();
    mc.stop = async () => { throw new Error('docker refused'); };
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(mc.calls).toEqual([]);
  });

  it('succeeds from the held descriptor when mc-backup prunes the archive during the safety backup', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    r.on('progress', (e: { step: string }) => { if (e.step === 'safety' && existsSync(archive)) unlinkSync(archive); });
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string } }).done;
    expect(existsSync(archive)).toBe(false);
    expect(done).toMatchObject({ ok: true, message: 'restored' });
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
  });

  it('aborts (not partial) and restarts the server when a failure happens before anything is removed', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    // Le marqueur ne peut pas être écrit (un dossier porte son nom) : échec juste avant la première suppression.
    mkdirSync(path.join(data, RESTORE_MARKER));
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    const done = (events.find((e) => 'done' in (e as object)) as { done: { ok: boolean; message: string; safetyBackup: string | null } }).done;
    expect(done.ok).toBe(false);
    expect(done.message).toMatch(/^aborted: /);
    expect(done.safetyBackup).toBe('world-20261010-120000.tgz');
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(mc.calls).toEqual(['stop:60', 'start']);
    expect(r.status().interrupted).toBeNull();
  });

  it('writes the marker before replacing, updates it at extract and removes it after success', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const seen: Record<string, string | null> = {};
    const r = service();
    r.on('progress', (e: { step: string }) => {
      if ((e.step === 'replace' || e.step === 'extract') && !(e.step in seen)) {
        const m = path.join(data, RESTORE_MARKER);
        seen[e.step] = existsSync(m) ? (JSON.parse(readFileSync(m, 'utf8')) as { step: string }).step : null;
      }
    });
    await r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(seen).toEqual({ replace: 'replace', extract: 'extract' });
    expect(existsSync(path.join(data, RESTORE_MARKER))).toBe(false);
  });

  it('start() reports a marker left by an interrupted restore; a dismiss or a new restore clears it', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const m = path.join(data, RESTORE_MARKER);
    writeFileSync(m, JSON.stringify({ archive: 'a.tgz', safetyBackup: 's.tgz', startedAt: '2026-10-10T10:00:00Z', step: 'extract' }));
    const r = service();
    await r.start();
    expect(r.status().interrupted).toEqual({ archive: 'a.tgz', safetyBackup: 's.tgz', startedAt: '2026-10-10T10:00:00Z' });
    await r.clearInterrupted();
    expect(r.status().interrupted).toBeNull();
    expect(existsSync(m)).toBe(false);
    writeFileSync(m, 'not json');
    const r2 = service();
    await r2.start();
    expect(r2.status().interrupted).toEqual({ archive: 'unknown', safetyBackup: null, startedAt: '' });
    await r2.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(r2.status().interrupted).toBeNull();
    expect(existsSync(m)).toBe(false);
  });

  it('start() without a marker reports nothing', async () => {
    const r = service();
    await r.start();
    expect(r.status().interrupted).toBeNull();
  });

  it('keeps the paths excluded by the EXCLUDES of the mc-backup container', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    mkdirSync(path.join(data, 'world', 'logs'));
    writeFileSync(path.join(data, 'world', 'logs', 'a.log'), 'LOG');
    writeFileSync(path.join(data, 'world', 'keep.dat'), 'KEEP');
    mcBackup.state = inspectFixture({ Env: ['EXCLUDES=*.dat,other'] });
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    // *.dat est exclu (level.dat gardé puis écrasé par l'extraction, keep.dat conservé) ; logs ne l'est plus.
    expect(readFileSync(path.join(data, 'world', 'keep.dat'), 'utf8')).toBe('KEEP');
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('BACKUP');
    expect(existsSync(path.join(data, 'world', 'logs'))).toBe(false);
  });

  it('refuses with 507 before anything when the data volume lacks free space', async () => {
    const r = service({ statfs: async () => ({ bavail: 1, bsize: 1 }) });
    await expect(r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn))
      .rejects.toMatchObject({ statusCode: 507, message: expect.stringMatching(/^Not enough free space on the data volume: need .+, have 1 B$/) });
    expect(lock.busy).toBeNull();
    expect(audits).toEqual([]);
    expect(r.status().running).toBe(false);
  });

  it('skips the free space check when statfs fails', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service({ statfs: async () => { throw new Error('ENOSYS'); } });
    await r.restore('world-20261010-100000.tgz', { startAfter: false, safetyBackup: true }, auditFn);
    await until(() => events.some((e) => 'done' in (e as object)));
    expect((events.find((e) => 'done' in (e as object)) as { done: { ok: boolean } }).done.ok).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('refuses with 500 and the chown hint when the data dir is not writable', async () => {
    chmodSync(data, 0o500);
    try {
      const r = service();
      const err = await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn).catch((e) => e);
      expect(err.statusCode).toBe(500);
      expect(err.message).toBe(`Cannot write ${data}: the data directory is not writable by the backend (UID 1000). Run chown -R 1000:1000 ${data} on the host.`);
    } finally { chmodSync(data, 0o700); }
    expect(readFileSync(path.join(data, 'world', 'level.dat'), 'utf8')).toBe('CURRENT');
    expect(audits).toEqual([]);
  });

  it('holds the data lock for the whole run so a manual backup gets 409 meanwhile', async () => {
    stopSucceeds(); safetyBackupSucceeds();
    const r = service();
    await r.restore('world-20261010-100000.tgz', { startAfter: true, safetyBackup: true }, auditFn);
    await expect(backupSvc.runNow()).rejects.toMatchObject({ statusCode: 409 });
    await until(() => events.some((e) => 'done' in (e as object)));
    expect(lock.busy).toBeNull();
  });
});

describe('parseExcludes', () => {
  it('uses the mc-backup defaults when EXCLUDES is absent', () => expect(parseExcludes(['FOO=1'])).toEqual(['*.jar', 'cache', 'logs', '*.tmp']));
  it('splits, trims and drops empties', () => expect(parseExcludes(['EXCLUDES= *.jar , ,logs,'])).toEqual(['*.jar', 'logs']));
  it('treats an explicitly empty EXCLUDES as no exclusion', () => expect(parseExcludes(['EXCLUDES='])).toEqual([]));
});
