import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testPrisma } from '../test-db.js';
import { aggregateHour, purgeSamples } from './aggregate.js';

const prisma = testPrisma();
afterAll(() => prisma.$disconnect());

describe('aggregateHour', () => {
  beforeAll(async () => {
    const hour = new Date('2026-10-10T10:00:00Z');
    await prisma.metricSample.createMany({ data: [
      { at: new Date('2026-10-10T10:00:15Z'), status: 'ready', players: 2, cpuPercent: 10, memUsed: 1000n, mspt: 2 },
      { at: new Date('2026-10-10T10:30:00Z'), status: 'ready', players: 4, cpuPercent: 30, memUsed: 3000n, mspt: 6 },
      { at: new Date('2026-10-10T11:00:00Z'), status: 'ready', players: 9, cpuPercent: 90, memUsed: 9000n, mspt: 9 },
      { at: new Date('2026-10-10T10:45:00Z'), status: 'stopped' },
    ] });
    await aggregateHour(prisma, hour);
  });
  it('averages and maxes only samples of that hour, ignoring null fields', async () => {
    const row = await prisma.metricHourly.findUnique({ where: { hour: new Date('2026-10-10T10:00:00Z') } });
    expect(row).toMatchObject({ playersAvg: 3, playersMax: 4, cpuAvg: 20, memAvg: 2000n, msptAvg: 4, msptMax: 6, samples: 3 });
  });
  it('is idempotent', async () => {
    await aggregateHour(prisma, new Date('2026-10-10T10:00:00Z'));
    expect(await prisma.metricHourly.count()).toBe(1);
  });
  it('purgeSamples removes old rows only', async () => {
    await purgeSamples(prisma, new Date('2026-10-10T10:40:00Z'));
    expect(await prisma.metricSample.count()).toBe(2);
  });
});
