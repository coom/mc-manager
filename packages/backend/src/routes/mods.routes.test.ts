import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { modsRoutes } from './mods.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

const view = { server: { loader: 'fabric', dir: 'mods' }, source: 'file', inlineEntries: [], listingExists: true, composeLine: 'x', restartRequired: false, modrinth: [], unmanagedLines: [], manual: [] };

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.mods = {
    view: vi.fn().mockResolvedValue(view), importFromEnv: vi.fn().mockResolvedValue(3), add: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), setFileEnabled: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue({ loader: 'fabric', gameVersion: null, hits: [] }),
    upload: vi.fn().mockResolvedValue(undefined), deleteFile: vi.fn().mockResolvedValue(undefined),
  };
  app.use('/api/mods', modsRoutes);
  app.use(errorHandler);
  return app;
}
const audited = (app: express.Express) => (app.locals.prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[0].data.action, c[0].data.detail]);

describe('mods routes', () => {
  it('lets a viewer read but not write', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/mods')).status).toBe(200);
    expect((await request(app).post('/api/mods/import')).status).toBe(403);
    expect((await request(app).post('/api/mods/modrinth').send({ entry: 'lithium' })).status).toBe(403);
    expect((await request(app).patch('/api/mods/modrinth/lithium').send({ enabled: false })).status).toBe(403);
    expect((await request(app).delete('/api/mods/modrinth/lithium')).status).toBe(403);
    expect((await request(app).patch('/api/mods/files/x.jar').send({ enabled: false })).status).toBe(403);
    expect(audited(app)).toEqual([]);
  });
  it('admin writes are applied, audited and answered with the fresh view', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/mods/import')).body).toEqual(view);
    expect((await request(app).post('/api/mods/modrinth').send({ entry: 'lithium:0.14.0' })).status).toBe(200);
    expect((await request(app).patch('/api/mods/modrinth/pl3xmap%3F').send({ enabled: false })).status).toBe(200);
    expect((await request(app).delete('/api/mods/modrinth/lithium%3A0.14.0')).status).toBe(200);
    expect((await request(app).patch('/api/mods/files/My%20Mod.jar').send({ enabled: true })).status).toBe(200);
    expect(app.locals.mods.add).toHaveBeenCalledWith('lithium:0.14.0');
    expect(app.locals.mods.setEnabled).toHaveBeenCalledWith('pl3xmap?', false);
    expect(app.locals.mods.remove).toHaveBeenCalledWith('lithium:0.14.0');
    expect(app.locals.mods.setFileEnabled).toHaveBeenCalledWith('My Mod.jar', true);
    expect(audited(app)).toEqual([['mods.import', '3 entries'], ['mods.add', 'lithium:0.14.0'], ['mods.toggle', 'pl3xmap? disabled'], ['mods.remove', 'lithium:0.14.0'], ['mods.file.toggle', 'My Mod.jar enabled']]);
  });
  it('validates bodies and path parameters before calling the service', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/mods/modrinth').send({})).status).toBe(400);
    expect((await request(app).post('/api/mods/modrinth').send({ entry: 'bad entry' })).body.code).toBe('invalid_entry');
    expect((await request(app).patch('/api/mods/modrinth/lithium').send({ enabled: 'yes' })).status).toBe(400);
    expect((await request(app).patch('/api/mods/modrinth/..%2Fx').send({ enabled: true })).body.code).toBe('invalid_entry');
    expect((await request(app).patch('/api/mods/files/..%2Fx.jar').send({ enabled: true })).status).toBe(404);
    expect((await request(app).patch('/api/mods/files/x.txt').send({ enabled: true })).status).toBe(404);
    expect(app.locals.mods.add).not.toHaveBeenCalled();
    expect(app.locals.mods.setEnabled).not.toHaveBeenCalled();
    expect(app.locals.mods.setFileEnabled).not.toHaveBeenCalled();
    expect(audited(app)).toEqual([]);
  });
  it('search is open to viewers, validates q and is not audited', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/mods/search?q=xaero')).status).toBe(200);
    expect(app.locals.mods.search).toHaveBeenCalledWith('xaero');
    expect((await request(app).get('/api/mods/search')).status).toBe(400);
    expect((await request(app).get('/api/mods/search?q=')).body.code).toBe('invalid_query');
    expect(audited(app)).toEqual([]);
  });
  it('upload streams the raw body to the service with name, replace and declared size, audited', async () => {
    const app = appWith('admin');
    const body = Buffer.from('PK\u0003\u0004fake');
    const res = await request(app).post('/api/mods/upload?name=My%20Mod.jar&replace=1').set('Content-Type', 'application/java-archive').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(view);
    const call = app.locals.mods.upload.mock.calls[0][0];
    expect(call.name).toBe('My Mod.jar');
    expect(call.replace).toBe(true);
    expect(call.declaredSize).toBe(body.length);
    expect(typeof call.body.pipe).toBe('function');
    expect(audited(app)).toEqual([['mods.upload', `My Mod.jar ${body.length}`]]);
  });
  it('upload validates name and Content-Length before reading, refuses viewers', async () => {
    const app = appWith('admin');
    expect((await request(app).post('/api/mods/upload?name=..%2Fx.jar').send('x')).body.code).toBe('invalid_name');
    expect((await request(app).post('/api/mods/upload?name=x.txt').send('x')).body.code).toBe('invalid_name');
    expect((await request(app).post('/api/mods/upload').send('x')).body.code).toBe('invalid_name');
    const big = await request(app).post('/api/mods/upload?name=x.jar').set('Content-Type', 'application/octet-stream').set('Content-Length', String(200 * 1024 * 1024)).send('x').then((r) => r.body.code, () => 'too_large');
    expect(big).toBe('too_large');
    expect(app.locals.mods.upload).not.toHaveBeenCalled();
    expect((await request(appWith('viewer')).post('/api/mods/upload?name=x.jar').send('x')).status).toBe(403);
  });
  it('delete removes a manual jar, audited', async () => {
    const app = appWith('admin');
    expect((await request(app).delete('/api/mods/files/My%20Mod.jar')).status).toBe(200);
    expect(app.locals.mods.deleteFile).toHaveBeenCalledWith('My Mod.jar');
    expect(audited(app)).toEqual([['mods.file.delete', 'My Mod.jar']]);
    expect((await request(app).delete('/api/mods/files/..%2Fx.jar')).status).toBe(404);
    expect((await request(appWith('viewer')).delete('/api/mods/files/x.jar')).status).toBe(403);
  });
  it('surfaces service errors with their code and does not audit them', async () => {
    const app = appWith('admin');
    app.locals.mods.add.mockRejectedValue(new AppError(422, 'no fabric version', undefined, 'loader_mismatch'));
    const res = await request(app).post('/api/mods/modrinth').send({ entry: 'plugin' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'no fabric version', code: 'loader_mismatch' });
    expect(audited(app)).toEqual([]);
  });
});
