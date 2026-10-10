import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serverRoutes } from './server.routes.js';
import { errorHandler } from '../middleware/error-handler.js';

function appWith(role: 'admin' | 'viewer', docker: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.docker = docker;
  app.locals.rcon = { send: vi.fn().mockResolvedValue('There are 0 of a max of 20 players online:') };
  app.locals.serverInfo = async () => ({ status: docker.getStatus(), containerName: 'mc' });
  app.use('/api/server', serverRoutes);
  app.use(errorHandler);
  return app;
}

describe('server routes', () => {
  let docker: Record<string, unknown>;
  beforeEach(() => {
    docker = { getStatus: () => 'ready', startServer: vi.fn().mockResolvedValue(undefined), stopServer: vi.fn().mockResolvedValue(undefined), restartServer: vi.fn().mockResolvedValue(undefined) };
  });
  it('GET returns the server info', async () => {
    const res = await request(appWith('viewer', docker)).get('/api/server');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });
  it('viewer cannot start', async () => {
    const res = await request(appWith('viewer', docker)).post('/api/server/start');
    expect(res.status).toBe(403);
    expect(docker.startServer).not.toHaveBeenCalled();
  });
  it('admin start returns 202 and writes an audit row', async () => {
    const app = appWith('admin', docker);
    const res = await request(app).post('/api/server/start');
    expect(res.status).toBe(202);
    expect(docker.startServer).toHaveBeenCalledOnce();
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'server.start' }) }));
  });
  it('viewer cannot send commands', async () => {
    expect((await request(appWith('viewer', docker)).post('/api/server/command').send({ command: 'list' })).status).toBe(403);
  });
  it('admin command is forwarded, audited and answered', async () => {
    const app = appWith('admin', docker);
    const res = await request(app).post('/api/server/command').send({ command: 'list' });
    expect(res.status).toBe(200);
    expect(res.body.response).toContain('players online');
    expect(app.locals.rcon.send).toHaveBeenCalledWith('list');
    expect(app.locals.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'rcon.command', detail: 'list' }) }));
  });
  it('rejects an empty or oversized command', async () => {
    expect((await request(appWith('admin', docker)).post('/api/server/command').send({ command: '' })).status).toBe(400);
    expect((await request(appWith('admin', docker)).post('/api/server/command').send({ command: 'x'.repeat(2000) })).status).toBe(400);
  });
});
