import { it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { testPrisma } from '../test-db.js';
import { auditRoutes } from './audit.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
const app = express();
app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'v', role: 'viewer' }; next(); });
app.locals.prisma = prisma;
app.use('/api/audit', auditRoutes);
app.use(errorHandler);

beforeAll(async () => {
  await prisma.auditLog.createMany({ data: [
    { userId: 1, username: 'alice', action: 'server.start' },
    { userId: 2, username: 'bob', action: 'rcon.command', detail: 'list' },
    { userId: 1, username: 'alice', action: 'backup.delete', detail: 'x.tgz' },
  ] });
});

it('pages newest first', async () => {
  const r = await request(app).get('/api/audit?page=1&pageSize=2');
  expect(r.body.total).toBe(3); expect(r.body.entries).toHaveLength(2); expect(r.body.entries[0].action).toBe('backup.delete');
});
it('filters by action prefix and user', async () => {
  expect((await request(app).get('/api/audit?action=rcon')).body.entries).toHaveLength(1);
  expect((await request(app).get('/api/audit?user=alice')).body.entries).toHaveLength(2);
});
it('rejects a bad page size', async () => { expect((await request(app).get('/api/audit?pageSize=1000')).status).toBe(400); });
