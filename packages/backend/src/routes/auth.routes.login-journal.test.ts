import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { testPrisma } from '../test-db.js';
import { authRoutes } from './auth.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.locals.prisma = prisma;
  a.use('/api/auth', authRoutes);
  a.use(errorHandler);
  return a;
}

async function lastRow() {
  await new Promise((r) => setTimeout(r, 50));
  return prisma.webLogin.findFirst({ orderBy: { id: 'desc' } });
}

describe('login journal', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { username: 'alice', displayName: 'Alice', role: 'admin', passwordHash: await bcrypt.hash('Correct-horse-1!', 4) } });
    await prisma.user.create({ data: { username: 'off', displayName: 'Off', role: 'viewer', enabled: false, passwordHash: await bcrypt.hash('Correct-horse-1!', 4) } });
  });

  it('records an unknown user', async () => {
    const res = await request(app()).post('/api/auth/login').send({ username: 'nobody', password: 'x' });
    expect(res.status).toBe(401);
    expect(await lastRow()).toMatchObject({ username: 'nobody', userId: null, success: false, reason: 'unknown_user' });
  });
  it('records a disabled account', async () => {
    await request(app()).post('/api/auth/login').send({ username: 'off', password: 'Correct-horse-1!' });
    expect(await lastRow()).toMatchObject({ username: 'off', success: false, reason: 'disabled' });
  });
  it('records a bad password with the user id', async () => {
    await request(app()).post('/api/auth/login').send({ username: 'alice', password: 'wrong' });
    const row = await lastRow();
    expect(row).toMatchObject({ username: 'alice', success: false, reason: 'bad_password' });
    expect(row?.userId).not.toBeNull();
  });
  it('records a success', async () => {
    const res = await request(app()).post('/api/auth/login').send({ username: 'alice', password: 'Correct-horse-1!' });
    expect(res.status).toBe(200);
    expect(await lastRow()).toMatchObject({ username: 'alice', success: true, reason: null });
  });
});
