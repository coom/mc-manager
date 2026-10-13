import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { BackupSettingsService } from './backup-settings-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const EP = ['/bin/bash', '-c', 'f=/backups/.mc-manager/backup-settings.conf\nexec /usr/bin/backup loop'];
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('BackupSettingsService', () => {
  let dir: string; let docker: FakeDocker; let bk: FakeContainer; let lock: DataLock; let svc: BackupSettingsService; let audits: string[];
  const file = () => path.join(dir, '.mc-manager', 'backup-settings.conf');
  const auditFn = async (d: string) => { audits.push(d); };
  /** mc-backup « géré » démarré il y a une minute ; un redémarrage avance StartedAt dans le futur proche. */
  const setContainer = (over: Parameters<typeof inspectFixture>[0] = {}) => {
    bk = new FakeContainer(inspectFixture({ Env: ['BACKUP_INTERVAL=6h', 'PRUNE_BACKUPS_DAYS=7'], Entrypoint: EP, StartedAt: ago(60_000), ...over }));
    bk.restart = async (o: { t: number }) => { bk.calls.push(`restart:${o.t}`); bk.state.State.StartedAt = new Date(Date.now() + 1000).toISOString(); };
    docker.containers.set('mc-backup', bk);
  };
  const writeSettings = (text: string) => { mkdirSync(path.dirname(file()), { recursive: true }); writeFileSync(file(), text); };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-bks-'));
    docker = new FakeDocker();
    lock = new DataLock();
    svc = new BackupSettingsService(dir, new DockerService(docker, 'mc', 'mc-backup'), lock);
    audits = [];
    setContainer();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  describe('read', () => {
    it('shows the compose values while no file exists', async () => {
      expect(await svc.read()).toEqual({
        containerFound: true, running: true, managed: true, cronSchedule: null,
        interval: { value: '6h', source: 'compose' }, pruneDays: { value: '7', source: 'compose' },
        pendingRestart: false, initialDelay: '2m', backupOnStartup: true,
      });
    });
    it('uses the file values and reports them pending until mc-backup restarts', async () => {
      writeSettings('BACKUP_INTERVAL=12h\nPRUNE_BACKUPS_DAYS=14\n');
      const s = await svc.read();
      expect(s.interval).toEqual({ value: '12h', source: 'file' });
      expect(s.pruneDays).toEqual({ value: '14', source: 'file' });
      expect(s.pendingRestart).toBe(true);
      bk.state.State.StartedAt = new Date(Date.now() + 1000).toISOString();
      expect((await svc.read()).pendingRestart).toBe(false);
    });
    it('ignores the file when the container does not read it', async () => {
      setContainer({ Entrypoint: undefined });
      writeSettings('BACKUP_INTERVAL=12h\n');
      const s = await svc.read();
      expect(s.managed).toBe(false);
      expect(s.interval).toEqual({ value: '6h', source: 'compose' });
      expect(s.pendingRestart).toBe(false);
    });
    it('reports a missing container', async () => {
      docker.containers.delete('mc-backup');
      expect(await svc.read()).toMatchObject({ containerFound: false, managed: false, interval: null, pruneDays: null });
    });
    it('reads image defaults, INITIAL_DELAY, BACKUP_ON_STARTUP and CRON_SCHEDULE', async () => {
      setContainer({ Env: ['INITIAL_DELAY=5m', 'BACKUP_ON_STARTUP=FALSE', 'CRON_SCHEDULE=0 */6 * * *'], Running: false });
      expect(await svc.read()).toMatchObject({
        running: false, cronSchedule: '0 */6 * * *', initialDelay: '5m', backupOnStartup: false,
        interval: { value: '24h', source: 'default' }, pruneDays: { value: '7', source: 'default' },
      });
    });
  });

  describe('apply', () => {
    it('writes the file atomically, restarts mc-backup, audits and returns the applied state', async () => {
      const s = await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(readFileSync(file(), 'utf8')).toBe('BACKUP_INTERVAL=12h\nPRUNE_BACKUPS_DAYS=14\n');
      expect(bk.calls).toEqual(['restart:10']);
      expect(audits).toEqual(['interval=12h pruneDays=14']);
      expect(s).toMatchObject({ interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' }, pendingRestart: false });
      expect(lock.busy).toBeNull();
    });
    it('only writes the file when mc-backup is stopped: no lock check, no restart, applied at its next start', async () => {
      setContainer({ Running: false });
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      const s = await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(readFileSync(file(), 'utf8')).toBe('BACKUP_INTERVAL=12h\nPRUNE_BACKUPS_DAYS=14\n');
      expect(bk.calls).toEqual([]);
      expect(audits).toEqual(['interval=12h pruneDays=14 (applies at next start)']);
      expect(s).toMatchObject({ running: false, pendingRestart: true, interval: { value: '12h', source: 'file' } });
      expect(lock.busy).toBeNull();
    });

    it('does nothing when the file already holds the same applied values', async () => {
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toEqual(['restart:10']);
      expect(audits).toHaveLength(1);
    });
    it('refuses with 409 busy while mc-backup holds its backup lock', async () => {
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      bk.execReply = (cmd) => (cmd[0] === 'flock' ? { exit: 1 } : undefined);
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'busy' });
      expect(bk.calls).toEqual(['exec:flock -n /backups/.mc-backup-lock true']);
      expect(existsSync(file())).toBe(false);
      expect(audits).toEqual([]);
      expect(lock.busy).toBeNull();
    });
    it('checks the lock under DEST_DIR', async () => {
      setContainer({ Env: ['DEST_DIR=/srv/b'] });
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      bk.execReply = () => ({ exit: 0 });
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toEqual(['exec:flock -n /srv/b/.mc-backup-lock true', 'restart:10']);
    });
    it('goes on when the lock check itself fails (flock missing)', async () => {
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      bk.execReply = () => ({ exit: 127 });
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toContain('restart:10');
    });
    it('does not exec flock when no lock file exists or SKIP_LOCKING is true', async () => {
      await svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      expect(bk.calls).toEqual(['restart:10']);
      setContainer({ Env: ['SKIP_LOCKING=TRUE'] });
      writeFileSync(path.join(dir, '.mc-backup-lock'), '');
      await svc.apply({ interval: '1d', pruneDays: 30 }, auditFn);
      expect(bk.calls).toEqual(['restart:10']);
    });
    it('is 409 busy while another data operation holds the lock', async () => {
      const release = lock.acquire('restore');
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'busy' });
      expect(existsSync(file())).toBe(false);
      release();
    });
    it('lets only one of two concurrent applies through', async () => {
      const releaseRestart = (() => { let r!: () => void; const gate = new Promise<void>((res) => { r = res; }); const orig = bk.restart; bk.restart = async (o) => { await gate; await orig(o); }; return () => r(); })();
      const first = svc.apply({ interval: '12h', pruneDays: 14 }, auditFn);
      await vi.waitFor(() => expect(lock.busy).toBe('backup-settings'));
      await expect(svc.apply({ interval: '1d', pruneDays: 30 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'busy' });
      releaseRestart();
      await first;
      expect(bk.calls).toEqual(['restart:10']);
      expect(readFileSync(file(), 'utf8')).toContain('BACKUP_INTERVAL=12h');
    });
    it('is 409 not_managed without the compose entrypoint or with CRON_SCHEDULE', async () => {
      setContainer({ Entrypoint: ['/usr/bin/backup'] });
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'not_managed' });
      setContainer({ Env: ['CRON_SCHEDULE='] });
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 409, code: 'not_managed' });
      expect(existsSync(file())).toBe(false);
    });
    it('is 503 container_missing without mc-backup', async () => {
      docker.containers.delete('mc-backup');
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 503, code: 'container_missing' });
    });
    it('is 400 invalid before touching anything', async () => {
      await expect(svc.apply({ interval: '0h', pruneDays: 7 }, auditFn)).rejects.toMatchObject({ statusCode: 400, code: 'invalid' });
      expect(bk.calls).toEqual([]);
    });
    it('keeps the file and reports 502 restart_failed when the restart fails', async () => {
      bk.restart = async () => { throw new Error('docker refused'); };
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 502, code: 'restart_failed' });
      expect(readFileSync(file(), 'utf8')).toContain('BACKUP_INTERVAL=12h');
      expect(audits).toEqual(['interval=12h pruneDays=14 (restart failed)']);
      expect((await svc.read()).pendingRestart).toBe(true);
      expect(lock.busy).toBeNull();
    });
    it('releases the lock and does not restart when the file cannot be written', async () => {
      writeFileSync(path.join(dir, '.mc-manager'), 'not a folder');
      await expect(svc.apply({ interval: '12h', pruneDays: 14 }, auditFn)).rejects.toMatchObject({ statusCode: 500, code: 'write_failed', message: expect.stringMatching(/a file named \.mc-manager/) });
      expect(bk.calls).toEqual([]);
      expect(audits).toEqual([]);
      expect(lock.busy).toBeNull();
    });
  });

  describe('pruneDaysForExec', () => {
    it('returns the file retention when managed, null otherwise', async () => {
      expect(await svc.pruneDaysForExec()).toBeNull();
      writeSettings('PRUNE_BACKUPS_DAYS=14\n');
      expect(await svc.pruneDaysForExec()).toBe(14);
      setContainer({ Entrypoint: undefined });
      expect(await svc.pruneDaysForExec()).toBeNull();
      docker.containers.delete('mc-backup');
      expect(await svc.pruneDaysForExec()).toBeNull();
    });
  });
});
