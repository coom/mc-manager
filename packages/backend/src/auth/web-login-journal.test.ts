import { describe, it, expect, vi, afterAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { recordWebLogin } from './web-login-journal.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());
const settle = () => new Promise((r) => setTimeout(r, 50));

describe('recordWebLogin', () => {
  it('writes a normalized row with a country', async () => {
    recordWebLogin(prisma, { username: 'alice', userId: 1, ip: '::ffff:8.8.8.8', success: true });
    await settle();
    const row = await prisma.webLogin.findFirst({ where: { username: 'alice' } });
    expect(row).toMatchObject({ userId: 1, ip: '8.8.8.8', success: true, reason: null });
    expect(row?.country).toMatch(/^[A-Z]{2}$/);
  });
  it('writes failures with their reason and an unknown ip placeholder', async () => {
    recordWebLogin(prisma, { username: 'nobody', userId: null, ip: undefined, success: false, reason: 'unknown_user' });
    await settle();
    expect(await prisma.webLogin.findFirst({ where: { username: 'nobody' } })).toMatchObject({ ip: 'unknown', country: null, success: false, reason: 'unknown_user' });
  });
  it('never throws when the write fails', async () => {
    const broken = { webLogin: { create: vi.fn().mockRejectedValue(new Error('db down')) } } as never;
    expect(() => recordWebLogin(broken, { username: 'x', userId: null, ip: '1.2.3.4', success: true })).not.toThrow();
    await settle();
  });
  it('truncates an oversized username', async () => {
    recordWebLogin(prisma, { username: 'a'.repeat(500), userId: null, ip: '1.2.3.4', success: false, reason: 'unknown_user' });
    await settle();
    expect((await prisma.webLogin.findFirst({ where: { username: { startsWith: 'aaaa' } } }))?.username).toHaveLength(64);
  });
});
