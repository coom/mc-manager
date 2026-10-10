import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { testPrisma } from '../test-db.js';
import { auditRoutes } from './audit.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(async () => { await prisma.$disconnect(); });

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = prisma;
  app.use('/api/audit', auditRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.auditLog.createMany({ data: [
    { userId: 1, username: 'root', action: 'player.ban_ip', detail: '8.8.8.8 (Alice): spam', ip: '1.2.3.4' },
    { userId: 1, username: 'root', action: 'player.pardon_ip', detail: '8.8.8.8', ip: '1.2.3.4' },
    { userId: 1, username: 'root', action: 'rcon.command', detail: 'list', ip: '1.2.3.4' },
  ] });
});

describe('GET /api/audit', () => {
  it('hides every ip from a viewer', async () => {
    const res = await request(appWith('viewer')).get('/api/audit');
    expect(res.status).toBe(200);
    const by = Object.fromEntries(res.body.entries.map((e: { action: string }) => [e.action, e]));
    expect(by['player.ban_ip'].detail).toBeNull();
    expect(by['player.pardon_ip'].detail).toBeNull();
    expect(by['rcon.command'].detail).toBe('list');
    expect(res.body.entries.every((e: { ip: unknown }) => e.ip === null)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/8\.8\.8\.8|1\.2\.3\.4/);
  });
  it('shows everything to an admin', async () => {
    const res = await request(appWith('admin')).get('/api/audit');
    const by = Object.fromEntries(res.body.entries.map((e: { action: string }) => [e.action, e]));
    expect(by['player.ban_ip'].detail).toBe('8.8.8.8 (Alice): spam');
    expect(by['player.pardon_ip'].detail).toBe('8.8.8.8');
    expect(res.body.entries.every((e: { ip: string }) => e.ip === '1.2.3.4')).toBe(true);
  });
});
