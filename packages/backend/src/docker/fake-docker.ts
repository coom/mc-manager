import { EventEmitter, PassThrough, Readable } from 'stream';
import type { ContainerInspect, ContainerLike, DockerEvent, DockerLike, DockerStatsSample } from './docker-like.js';

export class FakeContainer extends EventEmitter implements ContainerLike {
  calls: string[] = [];
  /** Si défini, stop()/restart() attendent cette promesse (simule un arrêt long). */
  opGate: Promise<void> | null = null;
  constructor(public state: ContainerInspect, public statsSample?: DockerStatsSample, public logsStream = new PassThrough(), public execStream = new PassThrough(), public execExit = 0) { super(); }
  async inspect() { return this.state; }
  async start() { this.calls.push('start'); }
  async stop(opts: { t: number }) { this.calls.push(`stop:${opts.t}`); if (this.opGate) await this.opGate; }
  async restart(opts: { t: number }) { this.calls.push(`restart:${opts.t}`); if (this.opGate) await this.opGate; }
  /** Bloque stop()/restart() jusqu'à l'appel de la fonction renvoyée. */
  holdOps(): () => void {
    let release!: () => void;
    this.opGate = new Promise<void>((r) => { release = r; });
    return () => { this.opGate = null; release(); };
  }
  async stats() { if (!this.statsSample) throw new Error('no stats'); return this.statsSample; }
  async logs() { return this.logsStream as unknown as Readable; }
  /** Environnement passé à chaque exec, dans l'ordre (undefined si aucun). */
  execEnvs: (string[] | undefined)[] = [];
  /** Réponse immédiate par commande (flux déjà terminé) ; undefined = comportement par défaut (execStream, execExit). */
  execReply?: (cmd: string[]) => { exit: number; output?: string } | undefined;
  async exec(opts: { Cmd: string[]; Env?: string[] }) {
    this.calls.push(`exec:${opts.Cmd.join(' ')}`);
    this.execEnvs.push(opts.Env);
    const reply = this.execReply?.(opts.Cmd);
    if (reply) {
      const s = new PassThrough();
      s.end(reply.output ?? '');
      return { start: async () => s as unknown as Readable, inspect: async () => ({ ExitCode: reply.exit, Running: false }) };
    }
    return { start: async () => this.execStream as unknown as Readable, inspect: async () => ({ ExitCode: this.execExit, Running: false }) };
  }
}

export class FakeDocker implements DockerLike {
  containers = new Map<string, FakeContainer>();
  eventStream = new PassThrough();
  async findByName(name: string) { return this.containers.get(name) ?? null; }
  async events() { return this.eventStream as unknown as Readable; }
  demux(stream: Readable, stdout: NodeJS.WritableStream) { stream.pipe(stdout); }
  emitEvent(ev: Partial<DockerEvent> & { Action: string; name: string }) {
    this.eventStream.write(JSON.stringify({ Type: 'container', Action: ev.Action, Actor: { ID: 'x', Attributes: { name: ev.name } }, time: Date.now() / 1000 }) + '\n');
  }
}

export function inspectFixture(over: Partial<ContainerInspect['State']> & { Tty?: boolean; Env?: string[]; Entrypoint?: string[] | string | null; Cmd?: string[] | string | null } = {}): ContainerInspect {
  const { Tty = false, Env = [], Entrypoint, Cmd, ...state } = over;
  return {
    Id: 'abc', Name: '/mc',
    Config: { Tty, Image: 'itzg/minecraft-server:latest', Env, ...(Entrypoint !== undefined ? { Entrypoint } : {}), ...(Cmd !== undefined ? { Cmd } : {}) },
    State: { Status: 'running', Running: true, StartedAt: '2026-10-10T10:00:00Z', Health: { Status: 'healthy' }, ...state },
  };
}
