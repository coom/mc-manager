import { EventEmitter } from 'events';
import Docker from 'dockerode';
import type { Readable } from 'stream';
import type { ServerStatus, ServerStats } from '@mc/common';
import type { ContainerInspect, ContainerLike, DockerLike, DockerStatsSample } from './docker-like.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export function statusFromInspect(i: ContainerInspect | null): ServerStatus {
  if (!i) return 'unavailable';
  if (!i.State.Running) return 'stopped';
  const h = i.State.Health?.Status;
  if (h === 'starting') return 'starting';
  if (h === 'unhealthy') return 'unhealthy';
  return 'ready';
}

export function cpuPercentFrom(s: DockerStatsSample): number | null {
  const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
  const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
  if (!(sysDelta > 0) || cpuDelta < 0) return null;
  return (cpuDelta / sysDelta) * (s.cpu_stats.online_cpus || 1) * 100;
}

/** Adaptateur dockerode → DockerLike. */
export function realDocker(socketPath: string): DockerLike {
  const docker = new Docker({ socketPath });
  return {
    async findByName(name) {
      const list = await docker.listContainers({ all: true, filters: { name: [name] } });
      const hit = list.find((c) => c.Names.includes(`/${name}`));
      return hit ? (docker.getContainer(hit.Id) as unknown as ContainerLike) : null;
    },
    async events(names) {
      return docker.getEvents({ filters: { type: ['container'], container: names } }) as unknown as Readable;
    },
    demux(stream, stdout, stderr) { docker.modem.demuxStream(stream, stdout, stderr); },
  };
}

export class DockerService extends EventEmitter {
  private status: ServerStatus = 'unavailable';
  private eventStream: Readable | null = null;
  private stopped = false;
  private retryMs = 1000;

  constructor(private docker: DockerLike, private serverName: string, private backupName: string) { super(); }

  getStatus(): ServerStatus { return this.status; }

  async inspectServer(): Promise<{ status: ServerStatus; startedAt: string | null; tty: boolean; id: string; image: string } | null> {
    const c = await this.docker.findByName(this.serverName);
    if (!c) return null;
    const i = await c.inspect();
    return { status: statusFromInspect(i), startedAt: i.State.Running ? i.State.StartedAt : null, tty: i.Config.Tty, id: i.Id, image: i.Config.Image };
  }

  private setStatus(s: ServerStatus) {
    if (s === this.status) return;
    this.status = s;
    this.emit('status', s);
  }

  async refresh(): Promise<ServerStatus> {
    try {
      const i = await this.inspectServer();
      this.setStatus(i ? i.status : 'unavailable');
    } catch (err) {
      logger.warn({ err }, 'docker inspect failed');
      this.setStatus('unavailable');
    }
    return this.status;
  }

  async start(): Promise<void> {
    this.stopped = false;
    // État initial posé sans émettre : seuls les changements ultérieurs sont signalés.
    try {
      const i = await this.inspectServer();
      this.status = i ? i.status : 'unavailable';
    } catch (err) {
      logger.warn({ err }, 'docker inspect failed');
    }
    void this.listen();
  }

  stop(): void {
    this.stopped = true;
    this.eventStream?.destroy();
    this.eventStream = null;
  }

  private async listen(): Promise<void> {
    while (!this.stopped) {
      try {
        const stream = await this.docker.events([this.serverName, this.backupName]);
        this.eventStream = stream;
        this.retryMs = 1000;
        let buf = '';
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
              if (!line) continue;
              try {
                const ev = JSON.parse(line) as { Action: string; Actor: { Attributes: Record<string, string> } };
                if (ev.Actor?.Attributes?.name !== this.serverName) continue;
                if (/^(start|die|stop|kill|destroy|health_status)/.test(ev.Action)) void this.refresh();
              } catch { /* ligne non JSON, ignorée */ }
            }
          });
          stream.once('end', resolve);
          stream.once('close', resolve);
          stream.once('error', reject);
        });
      } catch (err) {
        if (!this.stopped) logger.warn({ err }, 'docker events stream failed');
      }
      if (this.stopped) return;
      this.setStatus('unavailable');
      await new Promise((r) => setTimeout(r, this.retryMs));
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    }
  }

  private async requireServer(): Promise<ContainerLike> {
    const c = await this.docker.findByName(this.serverName);
    if (!c) throw new AppError(503, `Container "${this.serverName}" not found`);
    return c;
  }

  async startServer(): Promise<void> { const c = await this.requireServer(); await c.start(); void this.refresh(); }
  async stopServer(): Promise<void> { await this.gracefully('stop'); }
  async restartServer(): Promise<void> { await this.gracefully('restart'); }

  /** Passe en 'stopping' immédiatement (avant tout await), puis resynchronise sur l'état réel. */
  private async gracefully(op: 'stop' | 'restart'): Promise<void> {
    this.setStatus('stopping');
    try {
      const c = await this.requireServer();
      await c[op]({ t: 60 });
    } catch (err) {
      void this.refresh();
      throw err;
    }
    void this.refresh();
  }

  async stats(): Promise<ServerStats> {
    const c = await this.docker.findByName(this.serverName);
    if (!c) return { cpuPercent: null, memUsed: null, memLimit: null };
    try {
      const s = await c.stats({ stream: false });
      const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0;
      return { cpuPercent: cpuPercentFrom(s), memUsed: s.memory_stats.usage - cache, memLimit: s.memory_stats.limit };
    } catch { return { cpuPercent: null, memUsed: null, memLimit: null }; }
  }

  async logStream(tail: number): Promise<{ stream: Readable; tty: boolean }> {
    const c = await this.requireServer();
    const i = await c.inspect();
    const stream = await c.logs({ follow: true, stdout: true, stderr: true, tail, timestamps: false });
    return { stream, tty: i.Config.Tty };
  }

  demux(stream: Readable, out: NodeJS.WritableStream): void { this.docker.demux(stream, out, out); }

  async execBackup(cmd: string[]): Promise<{ stream: Readable; wait(): Promise<number> }> {
    const c = await this.docker.findByName(this.backupName);
    if (!c) throw new AppError(503, `Container "${this.backupName}" not found`);
    const exec = await c.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({});
    return {
      stream,
      wait: async () => {
        await new Promise<void>((resolve) => { stream.once('end', resolve); stream.once('close', resolve); });
        const info = await exec.inspect();
        return info.ExitCode ?? 1;
      },
    };
  }
}
