import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { userRoutes } from './users.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) }, appSetting: { upsert: vi.fn().mockResolvedValue({}) } };
  app.use('/api/users', userRoutes);
  app.use(errorHandler);
  return app;
}

describe('PUT /api/users/password-policy', () => {
  it('saves the policy and writes a user.update audit row', async () => {
    const app = appWith('admin');
    const res = await request(app).put('/api/users/password-policy').send({ minLength: 12, requireComplexity: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ minLength: 12, requireComplexity: true });
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'user.update', detail: 'password-policy' }) }));
  });

  it('is forbidden to a viewer and writes nothing', async () => {
    const app = appWith('viewer');
    expect((await request(app).put('/api/users/password-policy').send({ minLength: 12 })).status).toBe(403);
    expect(app.locals.prisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(app.locals.prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
