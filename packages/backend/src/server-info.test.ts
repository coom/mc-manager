import { describe, it, expect } from 'vitest';
import { buildServerInfo, type ServerInfoDeps } from './server-info.js';

const inspected = { status: 'ready' as const, startedAt: '2020-01-01T00:00:00Z', tty: false, id: 'abc', image: 'itzg/minecraft-server' };
const okStats = { cpuPercent: 10, memUsed: 100, memLimit: 1000 };

function deps(over: Partial<ServerInfoDeps> = {}): ServerInfoDeps {
  return {
    getStatus: () => 'ready',
    inspectServer: async () => inspected,
    stats: async () => okStats,
    latest: () => ({ version: '1.21.1', players: { online: 1, max: 20, names: ['Alice'] }, mspt: 4, tps: 20, worldBytes: 10, diskFree: 20 }),
    containerName: 'mc',
    ...over,
  };
}

describe('buildServerInfo', () => {
  it('takes status from getStatus() even when inspect reports healthy', async () => {
    const info = await buildServerInfo(deps({ getStatus: () => 'stopping' }));
    expect(info.status).toBe('stopping');
    expect(info.startedAt).toBe(inspected.startedAt);
    expect(info.uptimeSeconds).toBeGreaterThan(0);
    expect(info).toMatchObject({ containerName: 'mc', version: '1.21.1', mspt: 4, tps: 20, worldBytes: 10, diskFree: 20, stats: okStats });
    expect(info.message).toBeUndefined();
  });

  it('reports unavailable with a message when inspect returns null or throws', async () => {
    const a = await buildServerInfo(deps({ inspectServer: async () => null }));
    expect(a.status).toBe('unavailable');
    expect(a.message).toContain('"mc"');
    expect(a.startedAt).toBeNull();
    expect(a.uptimeSeconds).toBeNull();
    const b = await buildServerInfo(deps({ inspectServer: async () => { throw new Error('socket down'); } }));
    expect(b.status).toBe('unavailable');
    expect(b.message).toBeDefined();
  });

  it('returns null stats when stats() fails, and never throws', async () => {
    const info = await buildServerInfo(deps({ stats: async () => { throw new Error('boom'); }, latest: () => undefined }));
    expect(info.stats).toEqual({ cpuPercent: null, memUsed: null, memLimit: null });
    expect(info).toMatchObject({ version: null, players: null, mspt: null, tps: null, worldBytes: null, diskFree: null });
  });
});
