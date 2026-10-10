import { describe, it, expect, vi, afterAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { MetricsCollector } from './collector.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

function deps(over: Partial<ConstructorParameters<typeof MetricsCollector>[1]> = {}) {
  return {
    status: () => 'ready' as const,
    stats: async () => ({ cpuPercent: 12, memUsed: 500, memLimit: 1000 }),
    rcon: async (cmd: string) => (cmd === 'list' ? 'There are 1 of a max of 20 players online: Alice' : cmd === 'tick query' ? 'Average time per tick: 4.0ms' : 'Unknown command'),
    worldSize: async () => 1234,
    diskFree: async () => 999,
    broadcast: vi.fn(),
    serverInfo: async () => ({ status: 'ready' }) as never,
    ...over,
  };
}

describe('MetricsCollector', () => {
  it('stores a full sample when ready and exposes latest()', async () => {
    const d = deps();
    const c = new MetricsCollector(prisma, d, { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    const row = await prisma.metricSample.findFirst({ orderBy: { id: 'desc' } });
    expect(row).toMatchObject({ status: 'ready', players: 1, cpuPercent: 12, mspt: 4, tps: null, worldBytes: 1234n });
    expect(c.latest()).toMatchObject({ players: { online: 1, max: 20, names: ['Alice'] }, mspt: 4, worldBytes: 1234 });
    expect(d.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'metrics.tick' }));
  });

  it('stores mspt null when tick query is unknown (pre-1.20.3)', async () => {
    const c = new MetricsCollector(prisma, deps({ rcon: async (cmd) => (cmd === 'list' ? 'There are 0 of a max of 20 players online:' : 'Unknown or incomplete command') }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    const row = await prisma.metricSample.findFirst({ orderBy: { id: 'desc' } });
    expect(row?.mspt).toBeNull();
    expect(row?.players).toBe(0);
  });

  it('skips rcon fields when the server is not ready', async () => {
    const rcon = vi.fn();
    const c = new MetricsCollector(prisma, deps({ status: () => 'stopped' as const, rcon }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await c.tick();
    const row = await prisma.metricSample.findFirst({ orderBy: { id: 'desc' } });
    expect(row).toMatchObject({ status: 'stopped', players: null });
    expect(rcon).not.toHaveBeenCalled();
  });

  it('survives an rcon failure', async () => {
    const c = new MetricsCollector(prisma, deps({ rcon: async () => { throw new Error('down'); } }), { intervalMs: 15_000, diskIntervalMs: 0 });
    await expect(c.tick()).resolves.toBeUndefined();
  });
});
