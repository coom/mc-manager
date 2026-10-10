import type { PrismaClient } from '../../generated/prisma/index.js';
import type { ServerInfo, ServerStats, ServerStatus, WsMessage } from '@mc/common';
import { parseList, parseTickQuery, parseTps } from '../rcon/parsers.js';
import { aggregateHour, purgeHourly, purgeSamples } from './aggregate.js';
import { logger } from '../utils/logger.js';

export interface CollectorDeps {
  status: () => ServerStatus;
  stats: () => Promise<ServerStats>;
  rcon: (cmd: string) => Promise<string>;
  worldSize: () => Promise<number>;
  diskFree: () => Promise<number | null>;
  broadcast: (msg: WsMessage) => void;
  serverInfo: () => Promise<ServerInfo>;
}

export interface LatestMetrics {
  players: { online: number; max: number; names: string[] } | null;
  mspt: number | null;
  tps: number | null;
  worldBytes: number | null;
  diskFree: number | null;
  version: string | null;
}

export class MetricsCollector {
  private last: LatestMetrics = { players: null, mspt: null, tps: null, worldBytes: null, diskFree: null, version: null };
  private lastDiskAt = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private hourTimer: ReturnType<typeof setInterval> | null = null;
  private tpsSupported: boolean | null = null;

  constructor(private prisma: PrismaClient, private deps: CollectorDeps, private opts: { intervalMs: number; diskIntervalMs: number }) {}

  latest(): LatestMetrics { return this.last; }

  setVersion(v: string | null): void { this.last = { ...this.last, version: v }; }

  start(): void {
    void this.tick();
    this.tickTimer = setInterval(() => void this.tick(), this.opts.intervalMs);
    this.hourTimer = setInterval(() => void this.hourly(), 3_600_000);
    void this.hourly();
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.hourTimer) clearInterval(this.hourTimer);
  }

  async tick(): Promise<void> {
    const status = this.deps.status();
    let players: LatestMetrics['players'] = null;
    let mspt: number | null = null;
    let tps: number | null = null;
    let stats: ServerStats = { cpuPercent: null, memUsed: null, memLimit: null };

    if (status === 'ready') {
      stats = await this.deps.stats().catch(() => stats);
      try {
        players = parseList(await this.deps.rcon('list'));
        mspt = parseTickQuery(await this.deps.rcon('tick query'))?.mspt ?? null;
        if (this.tpsSupported !== false) {
          tps = parseTps(await this.deps.rcon('tps'));
          if (this.tpsSupported === null) this.tpsSupported = tps !== null;
        }
      } catch (err) { logger.debug({ err }, 'rcon metrics skipped'); }
    }

    const now = Date.now();
    if (now - this.lastDiskAt >= this.opts.diskIntervalMs) {
      this.lastDiskAt = now;
      const [worldBytes, diskFree] = await Promise.all([this.deps.worldSize().catch(() => null), this.deps.diskFree().catch(() => null)]);
      this.last = { ...this.last, worldBytes, diskFree };
    }

    this.last = { ...this.last, players, mspt, tps };
    try {
      await this.prisma.metricSample.create({ data: {
        status, players: players?.online ?? null, playerNames: players ? JSON.stringify(players.names) : null,
        cpuPercent: stats.cpuPercent, memUsed: stats.memUsed == null ? null : BigInt(Math.round(stats.memUsed)), memLimit: stats.memLimit == null ? null : BigInt(Math.round(stats.memLimit)),
        mspt, tps, worldBytes: this.last.worldBytes == null ? null : BigInt(this.last.worldBytes), diskFree: this.last.diskFree == null ? null : BigInt(this.last.diskFree),
      } });
    } catch (err) { logger.error({ err }, 'metric sample write failed'); }

    try { this.deps.broadcast({ type: 'metrics.tick', info: await this.deps.serverInfo() }); } catch { /* pas de client */ }
  }

  async hourly(): Promise<void> {
    try {
      const prev = new Date(Date.now() - 3_600_000);
      await aggregateHour(this.prisma, prev);
      await purgeSamples(this.prisma, new Date(Date.now() - 48 * 3_600_000));
      await purgeHourly(this.prisma, new Date(Date.now() - 400 * 86_400_000));
    } catch (err) { logger.error({ err }, 'hourly aggregation failed'); }
  }
}
