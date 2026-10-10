import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { testPrisma } from '../test-db.js';
import { journalRoutes } from './journal.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
const T0 = Date.parse('2026-10-10T12:00:00Z');
const at = (h: number) => new Date(T0 - h * 3_600_000);

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = prisma;
  app.use('/api/journal', journalRoutes);
  app.use(errorHandler);
  return { app };
}

beforeAll(async () => {
  await prisma.playerSession.createMany({ data: [
    { name: 'Alice', uuid: 'u1', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: at(5), leftAt: at(4) },
    { name: 'Bob', source: 'reconciled', joinedAt: at(2), leftAt: null },
    { name: 'Alicia', ip: '192.168.1.5', source: 'log', joinedAt: at(1), leftAt: at(0.5) },
  ] });
  await prisma.playerLoginFailure.createMany({ data: [
    { name: 'Mallory', ip: '198.51.100.7', reason: 'banned', message: 'You are banned', createdAt: at(3) },
    { name: 'Eve', reason: 'not_whitelisted', message: 'nope', createdAt: at(1) },
  ] });
  await prisma.webLogin.createMany({ data: [
    { username: 'admin', userId: 1, ip: '1.2.3.4', country: 'FR', success: true, createdAt: at(6) },
    { username: 'nobody', ip: '1.2.3.4', success: false, reason: 'unknown_user', createdAt: at(1) },
  ] });
});

describe('journal routes', () => {
  it('viewer is refused', async () => {
    const { app } = appWith('viewer');
    for (const url of ['/api/journal/players', '/api/journal/failures', '/api/journal/web', '/api/journal/retention']) expect((await request(app).get(url)).status, url).toBe(403);
    expect((await request(app).put('/api/journal/retention').send({ days: 10 })).status).toBe(403);
  });
  it('players: newest first, with ip and country, paginated', async () => {
    const res = await request(appWith('admin').app).get('/api/journal/players?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((s: { name: string }) => s.name)).toEqual(['Alicia', 'Bob']);
    expect(res.body.items[0]).toMatchObject({ ip: '192.168.1.5', country: null, leftAt: at(0.5).toISOString() });
    expect(res.body.items[1]).toMatchObject({ source: 'reconciled', ip: null, leftAt: null });
    const p2 = await request(appWith('admin').app).get('/api/journal/players?limit=2&page=2');
    expect(p2.body.items.map((s: { name: string }) => s.name)).toEqual(['Alice']);
  });
  it('players: filters by name (contains, case-insensitive) and by period', async () => {
    const byName = await request(appWith('admin').app).get('/api/journal/players?q=ALI');
    expect(byName.body.items.map((s: { name: string }) => s.name)).toEqual(['Alicia', 'Alice']);
    const byPeriod = await request(appWith('admin').app).get(`/api/journal/players?from=${at(3).toISOString()}&to=${at(0).toISOString()}`);
    expect(byPeriod.body.items.map((s: { name: string }) => s.name)).toEqual(['Alicia', 'Bob']);
    expect((await request(appWith('admin').app).get('/api/journal/players?from=yesterday')).status).toBe(400);
    expect((await request(appWith('admin').app).get('/api/journal/players?limit=500')).status).toBe(400);
  });
  it('failures and web journals', async () => {
    const f = await request(appWith('admin').app).get('/api/journal/failures?q=mal');
    expect(f.body.total).toBe(1);
    expect(f.body.items[0]).toMatchObject({ name: 'Mallory', reason: 'banned', ip: '198.51.100.7' });
    const w = await request(appWith('admin').app).get('/api/journal/web');
    expect(w.body.total).toBe(2);
    expect(w.body.items[0]).toMatchObject({ username: 'nobody', success: false, reason: 'unknown_user' });
    expect(w.body.items[1]).toMatchObject({ username: 'admin', userId: 1, country: 'FR' });
  });
  it('retention read, write, audit and validation', async () => {
    const { app } = appWith('admin');
    expect((await request(app).get('/api/journal/retention')).body).toEqual({ days: 90 });
    expect((await request(app).put('/api/journal/retention').send({ days: 30 })).body).toEqual({ days: 30 });
    expect((await request(app).get('/api/journal/retention')).body).toEqual({ days: 30 });
    expect(await prisma.auditLog.findMany()).toMatchObject([{ action: 'journal.retention', detail: '30' }]);
    for (const days of [-1, 4000, 1.5, 'x', undefined]) expect((await request(app).put('/api/journal/retention').send({ days })).status, String(days)).toBe(400);
  });
});
