import { Rcon } from 'rcon-client';
import type { ServerStatus } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import type { RconLike, RconConnection } from './rcon-like.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export const realRcon: RconLike = { connect: (opts) => Rcon.connect(opts) as unknown as Promise<RconConnection> };

type Credentials = () => Promise<{ enabled: boolean; port: number; password: string | null }>;

export class RconService {
  private conn: RconConnection | null = null;
  private connecting = false;
  private stopped = false;
  private retryMs = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private onStatus = (s: ServerStatus) => { if (s === 'ready') void this.connect(); else this.disconnect(); };

  constructor(private lib: RconLike, private docker: DockerService, private opts: { host: string; portFallback: number }, private credentials: Credentials) {}

  isConnected(): boolean { return this.conn !== null; }

  async start(): Promise<void> {
    this.stopped = false;
    this.docker.on('status', this.onStatus);
    if (this.docker.getStatus() === 'ready') await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.docker.off('status', this.onStatus);
    this.disconnect();
  }

  private disconnect(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const c = this.conn; this.conn = null;
    if (c) { try { void c.end(); } catch { /* déjà fermée */ } }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.connect(); }, this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.conn || this.connecting) return;
    if (this.docker.getStatus() !== 'ready') return;
    this.connecting = true;
    try {
      const cred = await this.credentials();
      if (!cred.enabled || !cred.password) { logger.warn('rcon disabled in server.properties'); return; }
      const c = await this.lib.connect({ host: this.opts.host, port: cred.port || this.opts.portFallback, password: cred.password, timeout: 10_000 });
      c.on('end', () => { if (this.conn === c) { this.conn = null; this.scheduleRetry(); } });
      c.on('error', (err) => logger.warn({ err }, 'rcon error'));
      this.conn = c;
      this.retryMs = 1000;
      logger.info('rcon connected');
    } catch (err) {
      logger.warn({ err }, 'rcon connect failed');
      this.scheduleRetry();
    } finally { this.connecting = false; }
  }

  send(cmd: string): Promise<string> {
    const run = async () => {
      const c = this.conn;
      if (!c) throw new AppError(503, 'RCON not connected');
      let t: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new AppError(504, 'RCON command timed out')), 10_000); });
      try { return await Promise.race([c.send(cmd), timeout]); } finally { clearTimeout(t); }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}
