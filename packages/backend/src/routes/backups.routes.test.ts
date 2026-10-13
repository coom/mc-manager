import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { backupsRoutes, backupDownloadRoutes } from './backups.routes.js';
import { DownloadTokenStore } from '../backups/download-tokens.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';
import { BackupService } from '../backups/backup-service.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';
import { BackupSettingsService } from '../backups/backup-settings-service.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function appWith(role: 'admin' | 'viewer', fake = new FakeDocker()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-bkr-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'w.tgz'), 'content');
  const app = express();
  app.use(express.json());
  app.locals.downloadTokens = new DownloadTokenStore();
  // Route publique montée avant l'injection de l'utilisateur, comme avant authMiddleware dans app.ts.
  app.use('/api/backups', backupDownloadRoutes);
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  const docker = new DockerService(fake, 'mc', 'mc-backup');
  app.locals.backups = new BackupService(dir, docker);
  app.locals.backupSettings = new BackupSettingsService(dir, docker, app.locals.backups.dataLock);
  app.locals.testDir = dir;
  app.use('/api/backups', backupsRoutes);
  app.use(errorHandler);
  return app;
}

describe('backups routes', () => {
  it('viewer can list', async () => { const r = await request(appWith('viewer')).get('/api/backups'); expect(r.status).toBe(200); expect(r.body.entries[0].name).toBe('w.tgz'); });
  it('viewer cannot get a download link, delete or run', async () => {
    const app = appWith('viewer');
    expect((await request(app).post('/api/backups/w.tgz/link')).status).toBe(403);
    expect((await request(app).delete('/api/backups/w.tgz')).status).toBe(403);
    expect((await request(app).post('/api/backups/run')).status).toBe(403);
    expect(app.locals.downloadTokens.size()).toBe(0);
  });
  it('admin link downloads once with attachment headers, audits, then 404 on reuse', async () => {
    const app = appWith('admin');
    const link = await request(app).post('/api/backups/w.tgz/link');
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/^\/api\/backups\/download\/[0-9a-f]{64}$/);
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.download', detail: 'w.tgz' }) }));
    const r = await request(app).get(link.body.url).buffer(true).parse((res, cb) => { let d = ''; res.on('data', (c: Buffer) => { d += c.toString(); }); res.on('end', () => cb(null, d)); });
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment; filename="w.tgz"');
    expect(r.body).toBe('content');
    expect((await request(app).get(link.body.url)).status).toBe(404);
  });
  it('unknown download tokens are 404', async () => {
    expect((await request(appWith('admin')).get('/api/backups/download/deadbeef')).status).toBe(404);
  });
  it('the old authenticated download route is gone', async () => {
    expect((await request(appWith('admin')).get('/api/backups/w.tgz/download')).status).toBe(404);
  });
  it('traversal and unknown names are 404', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/backups/..%2Fw.tgz/link')).status).toBe(404);
    expect((await request(app).post('/api/backups/nope.tgz/link')).status).toBe(404);
    expect((await request(app).delete('/api/backups/%2e%2e%2fw.tgz')).status).toBe(404);
    expect(app.locals.downloadTokens.size()).toBe(0);
  });
  it('admin delete returns 204', async () => { expect((await request(appWith('admin')).delete('/api/backups/w.tgz')).status).toBe(204); });
  it('run returns 503 when the backup container is missing', async () => { expect((await request(appWith('admin')).post('/api/backups/run')).status).toBe(503); });

  function auditDetails(app: express.Express): (string | null)[] {
    return (app.locals.prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls
      .filter(([a]) => a.data.action === 'backup.run').map(([a]) => a.data.detail);
  }
  it('run audits the exit code when the backup ends non-zero', async () => {
    const fake = new FakeDocker();
    const b = new FakeContainer(inspectFixture(), undefined, undefined, undefined, 3);
    fake.containers.set('mc-backup', b);
    const app = appWith('admin', fake);
    expect((await request(app).post('/api/backups/run')).status).toBe(202);
    (b.execStream as PassThrough).end();
    await vi.waitFor(() => expect(auditDetails(app)).toEqual([null, 'exit 3']));
  });
  it('run audits the failure when the backup throws', async () => {
    const fake = new FakeDocker();
    const b = new FakeContainer(inspectFixture());
    b.exec = async () => { throw new Error('exec refused'); };
    fake.containers.set('mc-backup', b);
    const app = appWith('admin', fake);
    expect((await request(app).post('/api/backups/run')).status).toBe(202);
    await vi.waitFor(() => expect(auditDetails(app)[1]).toMatch(/^failed: /));
  });
  it('viewer cannot restore but can read the restore status', async () => {
    const app = appWith('viewer');
    app.locals.restore = { status: () => ({ running: false, step: null }), restore: vi.fn() };
    expect((await request(app).post('/api/backups/w.tgz/restore').send({})).status).toBe(403);
    const st = await request(app).get('/api/backups/restore/status');
    expect(st.status).toBe(200);
    expect(st.body).toEqual({ running: false, step: null });
  });
  it('admin restore: defaults, 202, and the audit callback is wired to backup.restore', async () => {
    const app = appWith('admin');
    // Le service audite le nom suivi des options (voir restore-service.test.ts).
    const restore = vi.fn(async (_n: string, _o: unknown, auditFn: (d: string) => Promise<void>) => { await auditFn('w.tgz (startAfter=true, noSafety=false)'); });
    app.locals.restore = { status: () => ({ running: true, step: 'check' }), restore };
    const res = await request(app).post('/api/backups/w.tgz/restore').send({});
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true });
    expect(restore).toHaveBeenCalledWith('w.tgz', { startAfter: true, confirmNoSafetyBackup: false }, expect.any(Function));
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.restore', detail: 'w.tgz (startAfter=true, noSafety=false)' }) }));
  });
  it('admin clears the interrupted-restore marker (audited), viewer gets 403', async () => {
    const viewer = appWith('viewer');
    const clearV = vi.fn();
    viewer.locals.restore = { status: () => ({ running: false, step: null, interrupted: null }), clearInterrupted: clearV };
    expect((await request(viewer).delete('/api/backups/restore/interrupted')).status).toBe(403);
    expect(clearV).not.toHaveBeenCalled();
    const app = appWith('admin');
    const clearInterrupted = vi.fn().mockResolvedValue(undefined);
    app.locals.restore = { status: () => ({ running: false, step: null, interrupted: null }), clearInterrupted };
    expect((await request(app).delete('/api/backups/restore/interrupted')).status).toBe(204);
    expect(clearInterrupted).toHaveBeenCalled();
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.restore', detail: 'interrupted marker cleared' }) }));
  });
  it('admin restore forwards the options and surfaces the service error status', async () => {
    const app = appWith('admin');
    const restore = vi.fn().mockRejectedValue(new AppError(409, 'Server is stopped: no safety backup possible, confirm to proceed'));
    app.locals.restore = { status: () => ({ running: false, step: null }), restore };
    const res = await request(app).post('/api/backups/w.tgz/restore').send({ startAfter: false, confirmNoSafetyBackup: false });
    expect(res.status).toBe(409);
    expect(restore).toHaveBeenCalledWith('w.tgz', { startAfter: false, confirmNoSafetyBackup: false }, expect.any(Function));
    expect((await request(app).post('/api/backups/w.tgz/restore').send({ startAfter: 'yes' })).status).toBe(400);
  });
  const managedBackup = () => {
    const fake = new FakeDocker();
    fake.containers.set('mc-backup', new FakeContainer(inspectFixture({ Env: ['BACKUP_INTERVAL=6h'], Entrypoint: ['/bin/bash', '-c', 'f=/backups/.mc-manager/backup-settings.conf'] })));
    return fake;
  };
  it('viewer reads the backup settings but cannot change them', async () => {
    const app = appWith('viewer', managedBackup());
    const r = await request(app).get('/api/backups/settings');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ containerFound: true, managed: true, interval: { value: '6h', source: 'compose' } });
    expect((await request(app).put('/api/backups/settings').send({ interval: '12h', pruneDays: 14 })).status).toBe(403);
  });
  it('admin gets 400 invalid on a bad body', async () => {
    const r = await request(appWith('admin', managedBackup())).put('/api/backups/settings').send({ interval: '5m', pruneDays: 14 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid');
  });
  it('admin applies the settings and the change is audited as backup.settings', async () => {
    const app = appWith('admin', managedBackup());
    const r = await request(app).put('/api/backups/settings').send({ interval: '12h', pruneDays: 14 });
    expect(r.status).toBe(200);
    expect(r.body.interval).toEqual({ value: '12h', source: 'file' });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'backup.settings', detail: 'interval=12h pruneDays=14' }) }));
  });
  it('settings answer 503 container_missing without mc-backup', async () => {
    const r = await request(appWith('admin')).put('/api/backups/settings').send({ interval: '12h', pruneDays: 14 });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('container_missing');
  });

  const auditCalls = (app: express.Express, action: string) => (app.locals.prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls
    .filter(([a]) => a.data.action === action).map(([a]) => a.data.detail);
  /** Archive datée de `days` jours dans le dossier de l'app de test. */
  const archive = (app: express.Express, name: string, days: number) => {
    const full = path.join(app.locals.testDir, name);
    writeFileSync(full, 'x');
    const t = new Date(Date.now() - days * 86_400_000);
    utimesSync(full, t, t);
  };

  it('viewer cannot bulk delete nor apply the retention', async () => {
    const app = appWith('viewer', managedBackup());
    expect((await request(app).post('/api/backups/delete').send({ names: ['w.tgz'] })).status).toBe(403);
    expect((await request(app).get('/api/backups/prune')).status).toBe(403);
    expect((await request(app).post('/api/backups/prune').send({ names: ['w.tgz'] })).status).toBe(403);
    expect(existsSync(path.join(app.locals.testDir, 'w.tgz'))).toBe(true);
  });
  it('admin bulk delete removes the archives and audits each one as backup.delete', async () => {
    const app = appWith('admin');
    archive(app, 'x.tgz', 1);
    const r = await request(app).post('/api/backups/delete').send({ names: ['w.tgz', 'x.tgz'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deleted: ['w.tgz', 'x.tgz'] });
    expect(auditCalls(app, 'backup.delete')).toEqual(['w.tgz', 'x.tgz']);
  });
  it('bulk delete is all-or-nothing on an unknown name', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/backups/delete').send({ names: ['w.tgz', 'nope.tgz'] })).status).toBe(404);
    expect(existsSync(path.join(app.locals.testDir, 'w.tgz'))).toBe(true);
  });
  it.each([[{}], [{ names: [] }], [{ names: [1] }], [{ names: 'w.tgz' }], [{ names: Array.from({ length: 501 }, (_, i) => `a${i}.tgz`) }]])('bulk delete rejects invalid body #%# with 400 invalid_names', async (body) => {
    const r = await request(appWith('admin')).post('/api/backups/delete').send(body);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid_names');
  });
  it('prune preview lists the archives older than the retention, keeping the most recent one', async () => {
    const app = appWith('admin', managedBackup());
    archive(app, 'old-a.tgz', 10);
    archive(app, 'old-b.tar.gz', 30);
    const r = await request(app).get('/api/backups/prune');
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(7);
    expect(r.body.candidates.map((e: { name: string }) => e.name)).toEqual(['old-a.tgz', 'old-b.tar.gz']);
  });
  it('prune deletes only the confirmed names that are still candidates, audited as backup.prune', async () => {
    const app = appWith('admin', managedBackup());
    archive(app, 'old-a.tgz', 10);
    archive(app, 'old-b.tgz', 30);
    const r = await request(app).post('/api/backups/prune').send({ names: ['old-a.tgz', 'w.tgz', 'gone.tgz'] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ deleted: ['old-a.tgz'] });
    expect(existsSync(path.join(app.locals.testDir, 'old-b.tgz'))).toBe(true);
    expect(existsSync(path.join(app.locals.testDir, 'w.tgz'))).toBe(true);
    expect(auditCalls(app, 'backup.prune')).toEqual(['old-a.tgz (older than 7 days)']);
  });
  it('prune answers 409 retention_unknown without the backup container', async () => {
    const r = await request(appWith('admin')).get('/api/backups/prune');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('retention_unknown');
  });

  it('run and delete answer 409 while the data lock is held by a restore', async () => {
    const app = appWith('admin');
    const release = (app.locals.backups as BackupService).dataLock.acquire('restore');
    expect((await request(app).post('/api/backups/run')).status).toBe(409);
    expect((await request(app).delete('/api/backups/w.tgz')).status).toBe(409);
    release();
  });
});
