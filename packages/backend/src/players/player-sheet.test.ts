import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { testPrisma } from '../test-db.js';
import { buildPlayerSheet, dailyMinutes } from './player-sheet.js';

const prisma = testPrisma();
const dir = mkdtempSync(path.join(tmpdir(), 'mc-sheet-'));
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const now = new Date('2026-10-10T12:00:00Z');
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);

describe('dailyMinutes', () => {
  it('splits a session across UTC day boundaries and fills 30 days', () => {
    const out = dailyMinutes([{ joinedAt: new Date('2026-10-09T23:30:00Z'), leftAt: new Date('2026-10-10T00:30:00Z') }], now);
    expect(out).toHaveLength(30);
    expect(out.at(-1)).toEqual({ day: '2026-10-10', minutes: 30 });
    expect(out.at(-2)).toEqual({ day: '2026-10-09', minutes: 30 });
    expect(out[0].day).toBe('2026-09-11');
  });
  it('counts an open session up to now and ignores sessions outside the window', () => {
    const out = dailyMinutes([{ joinedAt: h(1), leftAt: null }, { joinedAt: new Date('2026-01-01T00:00:00Z'), leftAt: new Date('2026-01-01T01:00:00Z') }], now);
    expect(out.at(-1)).toEqual({ day: '2026-10-10', minutes: 60 });
    expect(out.reduce((a, b) => a + b.minutes, 0)).toBe(60);
  });
});

describe('buildPlayerSheet', () => {
  beforeEach(async () => {
    await prisma.playerSession.deleteMany();
    for (const f of ['ops.json', 'whitelist.json', 'banned-players.json', 'usercache.json', 'server.properties']) rmSync(path.join(dir, f), { force: true });
    rmSync(path.join(dir, 'world'), { recursive: true, force: true });
  });

  it('returns null for an invalid or unknown uuid', async () => {
    expect(await buildPlayerSheet(prisma, dir, '../x', { withIp: true, online: [] })).toBeNull();
    expect(await buildPlayerSheet(prisma, dir, UUID, { withIp: true, online: [] })).toBeNull();
  });

  it('aggregates sessions, names, flags and stats', async () => {
    await prisma.playerSession.createMany({ data: [
      { uuid: UUID, name: 'OldName', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: h(30), leftAt: h(29) },
      { uuid: UUID, name: 'Alice', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: h(3), leftAt: h(1) },
    ] });
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ uuid: UUID.toUpperCase(), name: 'Alice', level: 4, bypassesPlayerLimit: false }]));
    writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
    mkdirSync(path.join(dir, 'world', 'stats'), { recursive: true });
    writeFileSync(path.join(dir, 'world', 'stats', `${UUID}.json`), JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_time': 20 * 600 } } }));
    const sheet = await buildPlayerSheet(prisma, dir, UUID, { withIp: true, online: [], now });
    expect(sheet).toMatchObject({ uuid: UUID, name: 'Alice', previousNames: ['OldName'], online: false, op: true, whitelisted: false, banned: false, sessionCount: 2, playTimeObservedSeconds: 3 * 3600 });
    expect(sheet?.lastSeenAt).toBe(h(1).toISOString());
    expect(sheet?.sessions[0]).toMatchObject({ name: 'Alice', ip: '8.8.8.8', country: 'US' });
    expect(sheet?.stats?.playTimeSeconds).toBe(600);
    expect(sheet?.daily).toHaveLength(30);
  });

  it('hides ip and country for a viewer and marks the player online', async () => {
    await prisma.playerSession.create({ data: { uuid: UUID, name: 'Alice', ip: '8.8.8.8', country: 'US', source: 'log', joinedAt: h(1) } });
    const sheet = await buildPlayerSheet(prisma, dir, UUID, { withIp: false, online: [{ name: 'Alice', uuid: UUID, joinedAt: h(1).toISOString(), country: 'US', hasIp: true }], now });
    expect(sheet?.online).toBe(true);
    expect(sheet?.lastSeenAt).toBe(now.toISOString());
    expect(sheet?.sessions[0]).not.toHaveProperty('ip');
    expect(sheet?.sessions[0]).not.toHaveProperty('country');
    expect(sheet?.stats).toBeNull();
  });

  it('builds a sheet from usercache alone', async () => {
    writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Fresh', uuid: UUID, expiresOn: 'x' }]));
    const sheet = await buildPlayerSheet(prisma, dir, UUID, { withIp: true, online: [], now });
    expect(sheet).toMatchObject({ name: 'Fresh', sessionCount: 0, lastSeenAt: null, playTimeObservedSeconds: 0 });
  });
});
