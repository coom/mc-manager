import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { querySeries, bucketMinute } from './series.js';
const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

it('bucketMinute floors to the minute', () => expect(bucketMinute(new Date('2026-10-10T10:00:45Z')).toISOString()).toBe('2026-10-10T10:00:00.000Z'));

describe('querySeries', () => {
  beforeAll(async () => {
    const now = Date.now();
    await prisma.metricSample.createMany({ data: [
      { at: new Date(now - 60_000), status: 'ready', players: 1, cpuPercent: 10, memUsed: 100n, mspt: 1 },
      { at: new Date(now - 45_000), status: 'ready', players: 3, cpuPercent: 30, memUsed: 300n, mspt: 3 },
      { at: new Date(now - 30 * 3_600_000), status: 'ready', players: 7 },
    ] });
    await prisma.metricHourly.create({ data: { hour: new Date(now - 5 * 86_400_000), playersAvg: 2, playersMax: 5, cpuAvg: 1, memAvg: 1n, msptAvg: 1, msptMax: 1, samples: 10 } });
  });
  it('24h averages samples per minute within the window', async () => {
    const pts = await querySeries(prisma, '24h');
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ players: 2, cpuPercent: 20, memUsed: 200, mspt: 2 });
  });
  it('7d reads hourly rows', async () => {
    const pts = await querySeries(prisma, '7d');
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ players: 2, playersMax: 5 });
  });
});
