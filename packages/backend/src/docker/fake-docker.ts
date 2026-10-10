import { EventEmitter, PassThrough, Readable } from 'stream';
import type { ContainerInspect, ContainerLike, DockerEvent, DockerLike, DockerStatsSample } from './docker-like.js';

export class FakeContainer extends EventEmitter implements ContainerLike {
  calls: string[] = [];
  constructor(public state: ContainerInspect, public statsSample?: DockerStatsSample, public logsStream = new PassThrough(), public execStream = new PassThrough(), public execExit = 0) { super(); }
  async inspect() { return this.state; }
  async start() { this.calls.push('start'); }
  async stop(opts: { t: number }) { this.calls.push(`stop:${opts.t}`); }
  async restart(opts: { t: number }) { this.calls.push(`restart:${opts.t}`); }
  async stats() { if (!this.statsSample) throw new Error('no stats'); return this.statsSample; }
  async logs() { return this.logsStream as unknown as Readable; }
  async exec(opts: { Cmd: string[] }) {
    this.calls.push(`exec:${opts.Cmd.join(' ')}`);
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

export function inspectFixture(over: Partial<ContainerInspect['State']> & { Tty?: boolean } = {}): ContainerInspect {
  const { Tty = false, ...state } = over;
  return {
    Id: 'abc', Name: '/mc', Config: { Tty, Image: 'itzg/minecraft-server:latest' },
    State: { Status: 'running', Running: true, StartedAt: '2026-10-10T10:00:00Z', Health: { Status: 'healthy' }, ...state },
  };
}
