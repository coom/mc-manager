import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { LogLine } from '@mc/common';
import { testPrisma } from '../test-db.js';
import { PlayerJournal, GRACE_MS } from './player-journal.js';
import { saveRetentionDays } from './retention.js';

const prisma = testPrisma();
const dir = mkdtempSync(path.join(tmpdir(), 'mc-journal-'));
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const L = (message: string): LogLine => ({ ts: '10:00:00', level: 'INFO', thread: 'Server thread', message, raw: message });
let t = Date.parse('2026-10-10T10:00:00Z');
const now = () => new Date(t);
const advance = (ms: number) => { t += ms; };

function journal() {
  const j = new PlayerJournal(prisma, dir, now);
  const events: unknown[] = [];
  j.on('session', (e) => events.push(e));
  return { j, events };
}

beforeEach(async () => {
  t = Date.parse('2026-10-10T10:00:00Z');
  await prisma.playerSession.deleteMany();
  await prisma.playerLoginFailure.deleteMany();
  await prisma.webLogin.deleteMany();
  await prisma.metricSample.deleteMany();
  await prisma.appSetting.deleteMany();
  rmSync(path.join(dir, 'usercache.json'), { force: true });
});

describe('PlayerJournal sessions', () => {
  it('opens a session on join with uuid, ip and country, closes it on leave', async () => {
    const { j, events } = journal();
    await j.handleLine(L(`UUID of player Alice is ${UUID}`));
    await j.handleLine(L('Alice[/8.8.8.8:51234] logged in with entity id 1 at (0, 64, 0)'));
    expect(j.online()).toEqual([{ name: 'Alice', uuid: UUID, joinedAt: now().toISOString(), country: expect.stringMatching(/^[A-Z]{2}$/), hasIp: true }]);
    advance(90_000);
    await j.handleLine(L('Alice left the game'));
    expect(j.online()).toEqual([]);
    const rows = await prisma.playerSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uuid: UUID, name: 'Alice', ip: '8.8.8.8', source: 'log' });
    expect(rows[0].leftAt?.getTime()).toBe(t);
    expect(events).toEqual([
      { kind: 'join', player: expect.objectContaining({ name: 'Alice' }) },
      { kind: 'leave', player: expect.objectContaining({ name: 'Alice' }), leftAt: now().toISOString() },
    ]);
  });

  it('stores no country for a LAN address and exposes the current ip server-side only', async () => {
    const { j } = journal();
    await j.handleLine(L('Bob[/192.168.1.20:51234] logged in with entity id 1 at (0, 64, 0)'));
    expect((await prisma.playerSession.findFirst())?.country).toBeNull();
    expect(j.online()[0]).toMatchObject({ country: null, hasIp: true });
    expect(JSON.stringify(j.online())).not.toContain('192.168');
    expect(j.currentIp('bob')).toBe('192.168.1.20');
    expect(j.currentIp('Nobody')).toBeNull();
  });

  it('a second join without leave closes the first session', async () => {
    const { j } = journal();
    await j.handleLine(L('Bob[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(1000);
    await j.handleLine(L('Bob[/8.8.8.8:2] logged in with entity id 2 at (0, 64, 0)'));
    const rows = await prisma.playerSession.findMany({ orderBy: { id: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0].leftAt).not.toBeNull();
    expect(rows[1].leftAt).toBeNull();
    expect(j.online()).toHaveLength(1);
  });

  it('ignores a leave without an open session and unrelated lines', async () => {
    const { j, events } = journal();
    await j.handleLine(L('Ghost left the game'));
    await j.handleLine(L('Done (3.2s)! For help, type "help"'));
    expect(await prisma.playerSession.count()).toBe(0);
    expect(events).toEqual([]);
  });

  it('records a refusal with its reason', async () => {
    const { j } = journal();
    await j.handleLine(L('Disconnecting Mallory (/198.51.100.7:40000): You are not white-listed on this server!'));
    const row = await prisma.playerLoginFailure.findFirst();
    expect(row).toMatchObject({ name: 'Mallory', ip: '198.51.100.7', reason: 'not_whitelisted', message: 'You are not white-listed on this server!' });
  });

  it('falls back to usercache.json for the uuid', async () => {
    writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Carol', uuid: UUID, expiresOn: 'x' }]));
    const { j } = journal();
    await j.handleLine(L('Carol[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    expect((await prisma.playerSession.findFirst())?.uuid).toBe(UUID);
  });

  it('closes everything when the server stops', async () => {
    const { j } = journal();
    await j.handleLine(L('Bob[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    await j.onStatus('ready');
    expect(j.online()).toHaveLength(1);
    await j.onStatus('stopping');
    expect(j.online()).toHaveLength(0);
    expect((await prisma.playerSession.findFirst())?.leftAt).not.toBeNull();
  });
});

describe('PlayerJournal robustness', () => {
  it('keeps state consistent and the queue alive when a DB step fails', async () => {
    const { j, events } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    const spy = vi.spyOn(prisma.playerSession, 'update').mockRejectedValueOnce(new Error('db down'));
    await j.handleLine(L('Alice left the game'));
    expect(j.online().map((p) => p.name)).toEqual(['Alice']);
    expect(events.map((e) => (e as { kind: string }).kind)).toEqual(['join']);
    spy.mockRestore();
    await j.handleLine(L('Alice left the game'));
    expect(j.online()).toEqual([]);
    expect(events.map((e) => (e as { kind: string }).kind)).toEqual(['join', 'leave']);
    expect((await prisma.playerSession.findFirst())?.leftAt).not.toBeNull();
  });

  it('closeAll continues past a failing close', async () => {
    const { j } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    await j.handleLine(L('Bobby[/8.8.8.8:2] logged in with entity id 2 at (0, 64, 0)'));
    const spy = vi.spyOn(prisma.playerSession, 'update').mockRejectedValueOnce(new Error('db down'));
    await j.closeAll();
    spy.mockRestore();
    expect(j.online()).toHaveLength(1);
  });

  it('a failed create keeps the pending uuid for the next attempt', async () => {
    const { j } = journal();
    await j.handleLine(L(`UUID of player Alice is ${UUID}`));
    const spy = vi.spyOn(prisma.playerSession, 'create').mockRejectedValueOnce(new Error('db down'));
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    spy.mockRestore();
    expect(j.online()).toEqual([]);
    await j.handleLine(L('Alice[/8.8.8.8:2] logged in with entity id 2 at (0, 64, 0)'));
    expect(j.online()[0].uuid).toBe(UUID);
  });

  it.each(['unavailable', 'stopped'] as const)('closes open sessions on status %s', async (status) => {
    const { j } = journal();
    await j.handleLine(L('Bob[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    await j.onStatus(status);
    expect(j.online()).toEqual([]);
    expect((await prisma.playerSession.findFirst())?.leftAt).not.toBeNull();
  });

  it('reconcile does not consume a pending uuid', async () => {
    const { j } = journal();
    await j.handleLine(L(`UUID of player Alice is ${UUID}`));
    await j.reconcile(['Alice']);
    expect((await prisma.playerSession.findFirst())?.uuid).toBeNull();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    expect(j.online()[0].uuid).toBe(UUID);
  });
});

describe('PlayerJournal reconcile', () => {
  it('creates reconciled sessions for unseen names and closes stale ones after the grace period', async () => {
    const { j, events } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(GRACE_MS + 1000);
    await j.reconcile(['Bob']);
    const rows = await prisma.playerSession.findMany({ orderBy: { id: 'asc' } });
    expect(rows[0]).toMatchObject({ name: 'Alice', leftAt: now() });
    expect(rows[1]).toMatchObject({ name: 'Bob', ip: null, country: null, source: 'reconciled', leftAt: null });
    expect(j.online().map((p) => p.name)).toEqual(['Bob']);
    expect(j.online()[0].hasIp).toBe(false);
    expect(events.map((e) => (e as { kind: string }).kind)).toEqual(['join', 'leave', 'join']);
  });

  it('does not close a session younger than the grace period', async () => {
    const { j } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(1000);
    await j.reconcile([]);
    expect(j.online().map((p) => p.name)).toEqual(['Alice']);
  });

  it('does not recreate a player who left within the grace period', async () => {
    const { j } = journal();
    await j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)'));
    advance(GRACE_MS + 1000);
    await j.handleLine(L('Alice left the game'));
    advance(1000);
    await j.reconcile(['Alice']);
    expect(j.online()).toEqual([]);
    expect(await prisma.playerSession.count()).toBe(1);
  });

  it('ignores names that are not valid player names', async () => {
    const { j } = journal();
    await j.reconcile(['a-b', '']);
    expect(await prisma.playerSession.count()).toBe(0);
  });
});

describe('PlayerJournal start and purge', () => {
  it('closes orphan sessions at the last known metric sample', async () => {
    const joinedAt = new Date(t - 3_600_000);
    const lastTick = new Date(t - 600_000);
    await prisma.playerSession.create({ data: { name: 'Old', source: 'log', joinedAt } });
    await prisma.metricSample.create({ data: { at: lastTick, status: 'ready' } });
    const { j } = journal();
    await j.start();
    expect((await prisma.playerSession.findFirst())?.leftAt).toEqual(lastTick);
    expect(j.online()).toEqual([]);
  });

  it('never sets leftAt before joinedAt', async () => {
    const joinedAt = new Date(t - 60_000);
    await prisma.playerSession.create({ data: { name: 'Old', source: 'log', joinedAt } });
    await prisma.metricSample.create({ data: { at: new Date(t - 600_000), status: 'ready' } });
    const { j } = journal();
    await j.start();
    expect((await prisma.playerSession.findFirst())?.leftAt).toEqual(joinedAt);
  });

  it('purges rows older than the retention but keeps open sessions', async () => {
    await saveRetentionDays(prisma, 7);
    const old = new Date(t - 10 * 86_400_000);
    await prisma.playerSession.create({ data: { name: 'Old', source: 'log', joinedAt: old, leftAt: old } });
    await prisma.playerSession.create({ data: { name: 'Stuck', source: 'log', joinedAt: old } });
    await prisma.playerSession.create({ data: { name: 'Recent', source: 'log', joinedAt: now(), leftAt: now() } });
    await prisma.playerLoginFailure.create({ data: { name: 'X', reason: 'other', message: 'm', createdAt: old } });
    await prisma.webLogin.create({ data: { username: 'u', ip: '1.2.3.4', success: true, createdAt: old } });
    const { j } = journal();
    await j.purge();
    expect((await prisma.playerSession.findMany()).map((r) => r.name).sort()).toEqual(['Recent', 'Stuck']);
    expect(await prisma.playerLoginFailure.count()).toBe(0);
    expect(await prisma.webLogin.count()).toBe(0);
  });

  it('purges nothing when retention is 0', async () => {
    await saveRetentionDays(prisma, 0);
    const old = new Date(t - 400 * 86_400_000);
    await prisma.webLogin.create({ data: { username: 'u', ip: '1.2.3.4', success: true, createdAt: old } });
    await journal().j.purge();
    expect(await prisma.webLogin.count()).toBe(1);
  });

  it('serializes concurrent lines', async () => {
    const { j } = journal();
    await Promise.all([
      j.handleLine(L('Alice[/8.8.8.8:1] logged in with entity id 1 at (0, 64, 0)')),
      j.handleLine(L('Alice left the game')),
      j.handleLine(L('Alice[/8.8.8.8:2] logged in with entity id 2 at (0, 64, 0)')),
    ]);
    expect(j.online()).toHaveLength(1);
    expect(await prisma.playerSession.count()).toBe(2);
  });
});
