import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { backupsRoutes, backupDownloadRoutes } from './backups.routes.js';
import { DownloadTokenStore } from '../backups/download-tokens.js';
import { errorHandler } from '../middleware/error-handler.js';
import { BackupService } from '../backups/backup-service.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function appWith(role: 'admin' | 'viewer', fake = new FakeDocker()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-bkr-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'w.tgz'), 'content');
  const app = express();
  app.locals.downloadTokens = new DownloadTokenStore();
  // Route publique montée avant l'injection de l'utilisateur, comme avant authMiddleware dans app.ts.
  app.use('/api/backups', backupDownloadRoutes);
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.backups = new BackupService(dir, new DockerService(fake, 'mc', 'mc-backup'));
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
});
