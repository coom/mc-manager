import type { MetricPoint, MetricsRange } from '@mc/common';
import type { PrismaClient } from '../../generated/prisma/index.js';

export const bucketMinute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

export async function querySeries(prisma: PrismaClient, range: MetricsRange): Promise<MetricPoint[]> {
  const now = Date.now();
  if (range === '24h') {
    const rows = await prisma.metricSample.findMany({ where: { at: { gte: new Date(now - 86_400_000) } }, orderBy: { at: 'asc' } });
    const buckets = new Map<string, { n: number; players: number[]; cpu: number[]; mem: number[]; mspt: number[] }>();
    for (const r of rows) {
      const k = bucketMinute(r.at).toISOString();
      const b = buckets.get(k) ?? { n: 0, players: [], cpu: [], mem: [], mspt: [] };
      b.n++;
      if (r.players != null) b.players.push(r.players);
      if (r.cpuPercent != null) b.cpu.push(r.cpuPercent);
      if (r.memUsed != null) b.mem.push(Number(r.memUsed));
      if (r.mspt != null) b.mspt.push(r.mspt);
      buckets.set(k, b);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null);
    return [...buckets.entries()].map(([at, b]) => ({ at, players: avg(b.players), cpuPercent: avg(b.cpu), memUsed: avg(b.mem), mspt: avg(b.mspt) }));
  }
  const days = range === '7d' ? 7 : 30;
  const rows = await prisma.metricHourly.findMany({ where: { hour: { gte: new Date(now - days * 86_400_000) } }, orderBy: { hour: 'asc' } });
  return rows.map((r) => ({ at: r.hour.toISOString(), players: r.playersAvg, playersMax: r.playersMax, cpuPercent: r.cpuAvg, memUsed: r.memAvg == null ? null : Number(r.memAvg), mspt: r.msptAvg }));
}
