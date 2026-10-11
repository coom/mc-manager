import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { testPrisma } from '../test-db.js';
import { mapRoutes } from './map.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = prisma;
  app.use('/api/map', mapRoutes);
  app.use(errorHandler);
  return app;
}

describe('map routes', () => {
  beforeEach(async () => { await prisma.appSetting.deleteMany(); await prisma.auditLog.deleteMany(); });

  it('viewer can read but not write', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/map')).body).toEqual({ url: null });
    expect((await request(app).put('/api/map').send({ url: 'https://map.example.com/' })).status).toBe(403);
  });
  it('admin saves, reads back, clears, and every write is audited', async () => {
    const app = appWith('admin');
    expect((await request(app).put('/api/map').send({ url: 'https://map.example.com/' })).body).toEqual({ url: 'https://map.example.com/' });
    expect((await request(appWith('viewer')).get('/api/map')).body).toEqual({ url: 'https://map.example.com/' });
    expect((await request(app).put('/api/map').send({ url: '' })).body).toEqual({ url: null });
    expect((await request(app).get('/api/map')).body).toEqual({ url: null });
    expect((await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map((r) => [r.action, r.detail])).toEqual([['map.url', 'https://map.example.com/'], ['map.url', '']]);
  });
  it('trims and rejects anything but an http(s) URL of reasonable length', async () => {
    const app = appWith('admin');
    expect((await request(app).put('/api/map').send({ url: '  https://map.example.com/  ' })).body).toEqual({ url: 'https://map.example.com/' });
    for (const url of ['javascript:alert(1)', 'ftp://x', 'map.example.com', 'https://', 'https://' + 'a'.repeat(2048), 42, undefined]) {
      expect((await request(app).put('/api/map').send({ url })).status, String(url)).toBe(400);
    }
    expect(await prisma.auditLog.count()).toBe(1);
  });
  it('treats a stored value that is not a valid URL as unset', async () => {
    await prisma.appSetting.create({ data: { key: 'map.url', value: 'not a url' } });
    expect((await request(appWith('viewer')).get('/api/map')).body).toEqual({ url: null });
  });
});
