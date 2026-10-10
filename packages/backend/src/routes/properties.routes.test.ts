import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { propertiesRoutes } from './properties.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  const view = { raw: 'motd=x\n', values: { motd: 'x' }, locked: {}, exists: true, restartRequired: false };
  app.locals.properties = { read: vi.fn().mockResolvedValue(view), write: vi.fn().mockResolvedValue({ changed: ['motd'], view: { ...view, restartRequired: true } }) };
  app.use('/api/server/properties', propertiesRoutes);
  app.use(errorHandler);
  return app;
}

describe('properties routes', () => {
  it('viewer is refused on GET and PUT', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/server/properties')).status).toBe(403);
    expect((await request(app).put('/api/server/properties').send({ values: { motd: 'y' } })).status).toBe(403);
    expect(app.locals.properties.write).not.toHaveBeenCalled();
  });
  it('admin reads the view', async () => {
    const res = await request(appWith('admin')).get('/api/server/properties');
    expect(res.status).toBe(200);
    expect(res.body.values.motd).toBe('x');
  });
  it('admin writes values, audited with the changed keys, and gets the new view', async () => {
    const app = appWith('admin');
    const res = await request(app).put('/api/server/properties').send({ values: { motd: 'y' } });
    expect(res.status).toBe(200);
    expect(res.body.restartRequired).toBe(true);
    expect(app.locals.properties.write).toHaveBeenCalledWith({ values: { motd: 'y' } });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'server.properties', detail: 'motd' }) }));
  });
  it('raw mode is audited with the line count', async () => {
    const app = appWith('admin');
    await request(app).put('/api/server/properties').send({ raw: 'a=1\nb=2\n' });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'server.properties', detail: 'raw (2 lines)' }) }));
  });
  it('rejects a body with neither values nor raw, and surfaces service errors', async () => {
    const app = appWith('admin');
    expect((await request(app).put('/api/server/properties').send({})).status).toBe(400);
    expect((await request(app).put('/api/server/properties').send({ values: ['a'] })).status).toBe(400);
    app.locals.properties.write.mockRejectedValue(new AppError(409, 'Key motd is managed by MOTD'));
    const res = await request(app).put('/api/server/properties').send({ values: { motd: 'y' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Key motd is managed by MOTD');
  });
});
