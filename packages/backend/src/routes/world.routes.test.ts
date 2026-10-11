import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { worldRoutes } from './world.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

const state = { time: { daytime: 6000, day: 1 }, tick: { supported: true, targetRate: 20, frozen: false, sprinting: false }, difficulty: 'normal', defaultGamemode: 'survival', gamerules: { keepInventory: false }, resetOnRestart: {} };

function appWith(role: 'admin' | 'viewer') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = { auditLog: { create: vi.fn().mockResolvedValue({}) } };
  app.locals.world = {
    read: vi.fn().mockResolvedValue(state),
    setTime: vi.fn().mockResolvedValue(undefined), setWeather: vi.fn().mockResolvedValue(undefined), setDifficulty: vi.fn().mockResolvedValue(undefined),
    setDefaultGamemode: vi.fn().mockResolvedValue(undefined), setTick: vi.fn().mockResolvedValue(undefined), setGamerule: vi.fn().mockResolvedValue(undefined),
  };
  app.use('/api/world', worldRoutes);
  app.use(errorHandler);
  return app;
}
const auditOf = (app: ReturnType<typeof appWith>) => app.locals.prisma.auditLog.create;

describe('world routes', () => {
  it('refuses viewers everywhere', async () => {
    const app = appWith('viewer');
    expect((await request(app).get('/api/world')).status).toBe(403);
    expect((await request(app).put('/api/world/time').send({ preset: 'day' })).status).toBe(403);
    expect((await request(app).put('/api/world/gamerules/keepInventory').send({ value: true })).status).toBe(403);
    expect(app.locals.world.setTime).not.toHaveBeenCalled();
  });
  it('admin reads the state', async () => {
    const res = await request(appWith('admin')).get('/api/world');
    expect(res.status).toBe(200);
    expect(res.body.difficulty).toBe('normal');
  });
  it('each action is audited before the command and returns the re-read state', async () => {
    const app = appWith('admin');
    const cases: [string, object, string, string, unknown[]][] = [
      ['/api/world/time', { preset: 'night' }, 'world.time', 'night', ['night']],
      ['/api/world/weather', { kind: 'rain' }, 'world.weather', 'rain', ['rain']],
      ['/api/world/difficulty', { difficulty: 'hard' }, 'world.difficulty', 'hard', ['hard']],
      ['/api/world/gamemode', { gamemode: 'creative' }, 'world.gamemode', 'creative', ['creative']],
      ['/api/world/tick', { rate: 40 }, 'world.tick', 'rate=40', [{ rate: 40 }]],
      ['/api/world/tick', { frozen: true }, 'world.tick', 'frozen=true', [{ frozen: true }]],
      ['/api/world/tick', { sprint: 1200 }, 'world.tick', 'sprint=1200', [{ sprint: 1200 }]],
      ['/api/world/gamerules/keepInventory', { value: true }, 'world.gamerule', 'keepInventory=true', ['keepInventory', true]],
    ];
    for (const [path, body, action, detail, args] of cases) {
      const res = await request(app).put(path).send(body);
      expect(res.status, path).toBe(200);
      expect(res.body).toEqual(state);
      expect(auditOf(app)).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action, detail }) }));
      const fn = { 'world.time': 'setTime', 'world.weather': 'setWeather', 'world.difficulty': 'setDifficulty', 'world.gamemode': 'setDefaultGamemode', 'world.tick': 'setTick', 'world.gamerule': 'setGamerule' }[action]!;
      expect(app.locals.world[fn]).toHaveBeenCalledWith(...args);
    }
  });
  it('rejects invalid bodies with 400 and no audit line', async () => {
    const app = appWith('admin');
    expect((await request(app).put('/api/world/time').send({ preset: 'dawn' })).status).toBe(400);
    expect((await request(app).put('/api/world/tick').send({ rate: '40' })).status).toBe(400);
    expect((await request(app).put('/api/world/tick').send({})).status).toBe(400);
    expect((await request(app).put('/api/world/gamerules/randomTickSpeed').send({ value: 5.5 })).status).toBe(400);
    expect((await request(app).put('/api/world/gamerules/notARule').send({ value: true })).status).toBe(400);
    expect(auditOf(app)).not.toHaveBeenCalled();
    expect(app.locals.world.setTick).not.toHaveBeenCalled();
  });
  it('audits even when the command fails, and surfaces the service error', async () => {
    const app = appWith('admin');
    app.locals.world.setTick.mockRejectedValue(new AppError(501, 'Command not supported by this server', undefined, 'unsupported'));
    const res = await request(app).put('/api/world/tick').send({ rate: 40 });
    expect(res.status).toBe(501);
    expect(res.body.code).toBe('unsupported');
    expect(auditOf(app)).toHaveBeenCalledTimes(1);
  });
});
