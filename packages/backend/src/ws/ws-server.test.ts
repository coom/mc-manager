import { it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { authenticate } from './ws-server.js';
import { config } from '../config.js';
const prisma = { user: { findUnique: async () => ({ enabled: true }) } };
it('accepts an access token', async () => {
  const tok = jwt.sign({ typ: 'access', id: 1, username: 'u', role: 'admin' }, config.jwtSecret);
  expect(await authenticate({ url: `/ws?token=${tok}`, headers: { host: 'x' } } as never, prisma)).toMatchObject({ id: 1 });
});
it('rejects an mfa token and a missing token', async () => {
  const tok = jwt.sign({ typ: 'mfa', id: 1 }, config.jwtSecret);
  expect(await authenticate({ url: `/ws?token=${tok}`, headers: { host: 'x' } } as never, prisma)).toBeNull();
  expect(await authenticate({ url: '/ws', headers: { host: 'x' } } as never, prisma)).toBeNull();
});
