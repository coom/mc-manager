import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { testPrisma } from '../test-db.js';
import { playersRoutes, bansRoutes, listsRoutes, whitelistRoutes } from './players.routes.js';
import { errorHandler, AppError } from '../middleware/error-handler.js';

const prisma = testPrisma();
const dir = mkdtempSync(path.join(tmpdir(), 'mc-routes-'));
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const now = new Date('2026-10-10T12:00:00Z');

const audits = () => prisma.auditLog.findMany({ orderBy: { id: 'asc' } });

function appWith(role: 'admin' | 'viewer', online: unknown[] = []) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { typ: 'access', id: 1, username: 'u', role }; next(); });
  app.locals.prisma = prisma;
  app.locals.dataDir = dir;
  app.locals.journal = { online: () => online, currentIp: (n: string) => (n === 'Alice' ? '8.8.8.8' : null) };
  app.locals.playerAdmin = {
    kick: vi.fn().mockResolvedValue('Kicked Alice'), ban: vi.fn().mockResolvedValue('Banned Alice'), banIp: vi.fn().mockResolvedValue('Banned IP 1.2.3.4'),
    pardon: vi.fn().mockResolvedValue('Unbanned Alice'), pardonIp: vi.fn().mockResolvedValue('Unbanned IP 1.2.3.4'),
    op: vi.fn().mockResolvedValue('Made Alice a server operator'), deop: vi.fn().mockResolvedValue('Made Alice no longer a server operator'),
    whitelistAdd: vi.fn().mockResolvedValue('Added Alice to the whitelist'), whitelistRemove: vi.fn().mockResolvedValue('Removed Alice from the whitelist'),
    whitelistEnabled: vi.fn().mockResolvedValue('Turned on the whitelist'),
  };
  app.use('/api/players', playersRoutes);
  app.use('/api/bans', bansRoutes);
  app.use('/api/lists', listsRoutes);
  app.use('/api/whitelist', whitelistRoutes);
  app.use(errorHandler);
  return { app, admin: app.locals.playerAdmin };
}

beforeEach(async () => {
  await prisma.playerSession.deleteMany();
  await prisma.auditLog.deleteMany();
  for (const f of ['ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json', 'usercache.json']) rmSync(path.join(dir, f), { force: true });
});

describe('GET /api/players', () => {
  it('lists known players merged by uuid with flags, newest first', async () => {
    await prisma.playerSession.createMany({ data: [
      { uuid: UUID, name: 'OldName', source: 'log', joinedAt: new Date(now.getTime() - 86_400_000), leftAt: new Date(now.getTime() - 80_000_000) },
      { uuid: UUID, name: 'Alice', source: 'log', joinedAt: new Date(now.getTime() - 7_200_000), leftAt: new Date(now.getTime() - 3_600_000) },
      { uuid: null, name: 'NoUuid', source: 'reconciled', joinedAt: new Date(now.getTime() - 1_800_000), leftAt: new Date(now.getTime() - 900_000) },
    ] });
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ uuid: UUID, name: 'Alice', level: 4, bypassesPlayerLimit: false }]));
    const res = await request(appWith('viewer').app).get('/api/players');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((p: { name: string }) => p.name)).toEqual(['NoUuid', 'Alice']);
    expect(res.body.items[1]).toMatchObject({ uuid: UUID, sessionCount: 2, op: true, whitelisted: false, banned: false, online: false });
    expect(JSON.stringify(res.body)).not.toContain('"ip"');
  });
  it('filters by name and paginates', async () => {
    await prisma.playerSession.createMany({ data: ['Alice', 'Alicia', 'Bob'].map((name, i) => ({ name, source: 'log', joinedAt: new Date(now.getTime() - i * 60_000), leftAt: new Date(now.getTime() - i * 1000) })) });
    const res = await request(appWith('viewer').app).get('/api/players?q=ali&limit=1&page=2');
    expect(res.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(res.body.items[0].name).toBe('Alicia');
  });
  it('online=1 returns the journal view', async () => {
    const online = [{ name: 'Alice', uuid: UUID, joinedAt: now.toISOString(), country: 'FR', hasIp: true }];
    const res = await request(appWith('viewer', online).app).get('/api/players?online=1');
    expect(res.body.items).toEqual(online);
  });
  it('marks an online player', async () => {
    await prisma.playerSession.create({ data: { uuid: UUID, name: 'Alice', source: 'log', joinedAt: now } });
    const res = await request(appWith('viewer', [{ name: 'Alice', uuid: UUID, joinedAt: now.toISOString(), country: null, hasIp: true }]).app).get('/api/players');
    expect(res.body.items[0].online).toBe(true);
  });
});

describe('GET /api/players/:uuid', () => {
  it('404 for unknown or invalid', async () => {
    expect((await request(appWith('viewer').app).get(`/api/players/${UUID}`)).status).toBe(404);
    expect((await request(appWith('viewer').app).get('/api/players/not-a-uuid')).status).toBe(404);
  });
  it('viewer gets the sheet without ip, admin with ip', async () => {
    await prisma.playerSession.create({ data: { uuid: UUID, name: 'Alice', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: now, leftAt: now } });
    const v = await request(appWith('viewer').app).get(`/api/players/${UUID}`);
    expect(v.status).toBe(200);
    expect(v.body.sessions[0]).not.toHaveProperty('ip');
    const a = await request(appWith('admin').app).get(`/api/players/${UUID}`);
    expect(a.body.sessions[0]).toMatchObject({ ip: '8.8.8.8', country: 'US' });
  });
});

describe('actions', () => {
  it('viewer is refused everywhere without calling the admin service', async () => {
    const { app, admin } = appWith('viewer');
    for (const [m, url] of [['post', '/api/players/Alice/kick'], ['post', '/api/players/Alice/ban'], ['post', '/api/players/Alice/ban-ip'], ['post', '/api/players/Alice/pardon'], ['post', '/api/players/Alice/op'], ['post', '/api/players/Alice/deop'], ['post', '/api/bans/ip'], ['delete', '/api/bans/ip/1.2.3.4'], ['post', '/api/whitelist/Alice'], ['delete', '/api/whitelist/Alice'], ['put', '/api/whitelist/enabled']] as const) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[m](url);
      expect(res.status, `${m} ${url}`).toBe(403);
    }
    for (const fn of Object.values(admin)) expect(fn).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });
  it('kick with reason writes the audit row before calling the server', async () => {
    const { app, admin } = appWith('admin');
    admin.kick.mockImplementation(async () => { expect(await prisma.auditLog.count()).toBe(1); return 'Kicked Alice'; });
    const res = await request(app).post('/api/players/Alice/kick').send({ reason: 'afk' });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Kicked Alice');
    expect(admin.kick).toHaveBeenCalledWith('Alice', 'afk');
    expect(await audits()).toMatchObject([{ action: 'player.kick', detail: 'Alice: afk', username: 'u' }]);
  });
  it('invalid name is 400 before audit', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/players/a%20b/kick')).status).toBe(400);
    expect(await audits()).toHaveLength(0);
    expect(admin.kick).not.toHaveBeenCalled();
  });
  it('ban, pardon, op, deop are audited with the name', async () => {
    const { app } = appWith('admin');
    for (const url of ['ban', 'pardon', 'op', 'deop']) expect((await request(app).post(`/api/players/Alice/${url}`)).status).toBe(200);
    expect((await audits()).map((a) => [a.action, a.detail])).toEqual([['player.ban', 'Alice'], ['player.pardon', 'Alice'], ['player.op', 'Alice'], ['player.deop', 'Alice']]);
  });
  it('ban-ip by player name uses the ip known server-side', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/players/Alice/ban-ip').send({ reason: 'spam' })).status).toBe(200);
    expect(admin.banIp).toHaveBeenCalledWith('8.8.8.8', 'spam');
    expect(await audits()).toMatchObject([{ action: 'player.ban_ip', detail: '8.8.8.8 (Alice): spam' }]);
    expect((await request(app).post('/api/players/Bob/ban-ip')).status).toBe(409);
    expect(await audits()).toHaveLength(1);
  });
  it('ban-ip and pardon-ip by address', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/bans/ip').send({ ip: '1.2.3.4', reason: 'spam' })).status).toBe(200);
    expect(admin.banIp).toHaveBeenCalledWith('1.2.3.4', 'spam');
    expect((await request(app).delete('/api/bans/ip/1.2.3.4')).status).toBe(200);
    expect(admin.pardonIp).toHaveBeenCalledWith('1.2.3.4');
    expect((await audits()).map((a) => [a.action, a.detail])).toEqual([['player.ban_ip', '1.2.3.4: spam'], ['player.pardon_ip', '1.2.3.4']]);
    expect((await request(app).post('/api/bans/ip').send({ ip: '1.2.3.4 x' })).status).toBe(400);
  });
  it('whitelist add/remove/enabled', async () => {
    const { app, admin } = appWith('admin');
    expect((await request(app).post('/api/whitelist/Alice')).status).toBe(200);
    expect((await request(app).delete('/api/whitelist/Alice')).status).toBe(200);
    expect((await request(app).put('/api/whitelist/enabled').send({ enabled: true })).status).toBe(200);
    expect(admin.whitelistEnabled).toHaveBeenCalledWith(true);
    expect((await audits()).map((a) => [a.action, a.detail])).toEqual([['whitelist.add', 'Alice'], ['whitelist.remove', 'Alice'], ['whitelist.toggle', 'on']]);
    expect((await request(app).put('/api/whitelist/enabled').send({ enabled: 'yes' })).status).toBe(400);
  });
  it('a failing action is still audited and returns its status', async () => {
    const { app, admin } = appWith('admin');
    admin.op.mockRejectedValue(new AppError(503, 'RCON not connected'));
    expect((await request(app).post('/api/players/Alice/op')).status).toBe(503);
    expect(await audits()).toHaveLength(1);
  });
});

describe('GET /api/lists', () => {
  it('returns the four lists to an admin, including banned ips', async () => {
    writeFileSync(path.join(dir, 'banned-ips.json'), JSON.stringify([{ ip: '1.2.3.4', created: '', source: 'Server', expires: 'forever', reason: '' }]));
    const res = await request(appWith('admin').app).get('/api/lists');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ whitelist: [], ops: [], bannedPlayers: [], bannedIps: [{ ip: '1.2.3.4' }], whitelistEnabled: false });
  });
  it('hides banned ips from a viewer', async () => {
    writeFileSync(path.join(dir, 'banned-ips.json'), JSON.stringify([{ ip: '1.2.3.4', created: '', source: 'Server', expires: 'forever', reason: '' }]));
    const res = await request(appWith('viewer').app).get('/api/lists');
    expect(res.status).toBe(200);
    expect(res.body.bannedIps).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('1.2.3.4');
  });
});
