import type { PrismaClient } from '../../generated/prisma/index.js';

export async function aggregateHour(prisma: PrismaClient, hour: Date): Promise<void> {
  const start = new Date(hour); start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 3_600_000);
  const rows = await prisma.metricSample.findMany({ where: { at: { gte: start, lt: end }, players: { not: null } } });
  if (rows.length === 0) return;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const nums = (f: (r: typeof rows[number]) => number | null | undefined) => rows.map(f).filter((x): x is number => typeof x === 'number');
  const mems = rows.map((r) => r.memUsed).filter((x): x is bigint => x != null);
  const data = {
    playersAvg: avg(nums((r) => r.players)) ?? 0,
    playersMax: Math.max(0, ...nums((r) => r.players)),
    cpuAvg: avg(nums((r) => r.cpuPercent)),
    memAvg: mems.length ? mems.reduce((a, b) => a + b, 0n) / BigInt(mems.length) : null,
    msptAvg: avg(nums((r) => r.mspt)),
    msptMax: nums((r) => r.mspt).length ? Math.max(...nums((r) => r.mspt)) : null,
    worldBytes: rows.map((r) => r.worldBytes).filter((x) => x != null).at(-1) ?? null,
    samples: await prisma.metricSample.count({ where: { at: { gte: start, lt: end } } }),
  };
  await prisma.metricHourly.upsert({ where: { hour: start }, create: { hour: start, ...data }, update: data });
}

export const purgeSamples = (prisma: PrismaClient, olderThan: Date) => prisma.metricSample.deleteMany({ where: { at: { lt: olderThan } } });
export const purgeHourly = (prisma: PrismaClient, olderThan: Date) => prisma.metricHourly.deleteMany({ where: { hour: { lt: olderThan } } });
