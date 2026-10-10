import { describe, it, expect, vi, afterEach } from 'vitest';
import { PassThrough, Readable } from 'stream';
import { DockerService, statusFromInspect, cpuPercentFrom } from './docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from './fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('statusFromInspect', () => {
  it('maps null to unavailable', () => expect(statusFromInspect(null)).toBe('unavailable'));
  it('maps exited to stopped', () => expect(statusFromInspect(inspectFixture({ Status: 'exited', Running: false }))).toBe('stopped'));
  it('maps running+starting to starting', () => expect(statusFromInspect(inspectFixture({ Health: { Status: 'starting' } }))).toBe('starting'));
  it('maps running+healthy to ready', () => expect(statusFromInspect(inspectFixture())).toBe('ready'));
  it('maps running+unhealthy to unhealthy', () => expect(statusFromInspect(inspectFixture({ Health: { Status: 'unhealthy' } }))).toBe('unhealthy'));
  it('maps running without healthcheck to ready', () => expect(statusFromInspect(inspectFixture({ Health: undefined }))).toBe('ready'));
});

describe('cpuPercentFrom', () => {
  it('computes percent from deltas and online cpus', () => {
    const pct = cpuPercentFrom({
      cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 10_000, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 8_000 },
      memory_stats: { usage: 0, limit: 0 },
    });
    expect(pct).toBeCloseTo(200);
  });
});

describe('DockerService', () => {
  it('resolves the container by name on every call so a recreated container is found', async () => {
    const docker = new FakeDocker();
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    expect(await svc.inspectServer()).toBeNull();
    docker.containers.set('mc', new FakeContainer(inspectFixture()));
    expect((await svc.inspectServer())?.status).toBe('ready');
    docker.containers.set('mc', new FakeContainer({ ...inspectFixture(), Id: 'new-id' }));
    expect((await svc.inspectServer())?.id).toBe('new-id');
  });

  it('emits status on docker events', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture({ Status: 'exited', Running: false }));
    docker.containers.set('mc', c);
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    const seen: string[] = [];
    svc.on('status', (s) => seen.push(s));
    await svc.start();
    expect(svc.getStatus()).toBe('stopped');
    c.state = inspectFixture({ Health: { Status: 'starting' } });
    docker.emitEvent({ Action: 'start', name: 'mc' });
    await wait(10);
    c.state = inspectFixture();
    docker.emitEvent({ Action: 'health_status: healthy', name: 'mc' });
    await wait(10);
    expect(seen).toEqual(['starting', 'ready']);
    svc.stop();
  });

  it('ignores events from other containers', async () => {
    const docker = new FakeDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture()));
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    const seen: string[] = [];
    svc.on('status', (s) => seen.push(s));
    await svc.start();
    docker.emitEvent({ Action: 'die', name: 'other' });
    await wait(10);
    expect(seen).toEqual([]);
    // Contrôle positif : le même flux réagit bien aux événements de mc.
    docker.containers.get('mc')!.state = inspectFixture({ Status: 'exited', Running: false });
    docker.emitEvent({ Action: 'die', name: 'mc' });
    await wait(10);
    expect(seen).toEqual(['stopped']);
    svc.stop();
  });

  it('stopServer uses a 60 s grace period and sets stopping', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture());
    docker.containers.set('mc', c);
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    const p = svc.stopServer();
    expect(svc.getStatus()).toBe('stopping');
    await p;
    expect(c.calls).toEqual(['stop:60']);
    svc.stop();
  });

  it('keeps stopping sticky during a pending stop, then settles on the real state', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture());
    docker.containers.set('mc', c);
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    const seen: string[] = [];
    svc.on('status', (s) => seen.push(s));
    await svc.start();
    await wait(10);
    const release = c.holdOps();
    const p = svc.stopServer();
    await wait(10);
    expect(svc.getStatus()).toBe('stopping');
    // docker stop émet 'kill' tout de suite ; le conteneur inspecte encore running+healthy.
    docker.emitEvent({ Action: 'kill', name: 'mc' });
    await wait(10);
    docker.emitEvent({ Action: 'health_status: healthy', name: 'mc' });
    await wait(10);
    expect(svc.getStatus()).toBe('stopping');
    c.state = inspectFixture({ Status: 'exited', Running: false });
    release();
    await p;
    await wait(10);
    expect(svc.getStatus()).toBe('stopped');
    expect(seen).toEqual(['stopping', 'stopped']);
    svc.stop();
  });

  it('accepts stopped from a die event while the stop is still pending', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture());
    docker.containers.set('mc', c);
    const svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    await wait(10);
    const release = c.holdOps();
    const p = svc.stopServer();
    c.state = inspectFixture({ Status: 'exited', Running: false });
    docker.emitEvent({ Action: 'die', name: 'mc' });
    await wait(10);
    expect(svc.getStatus()).toBe('stopped');
    release();
    await p;
    svc.stop();
  });

  it('throws a 503 AppError when the container is missing', async () => {
    const svc = new DockerService(new FakeDocker(), 'mc', 'mc-backup');
    await expect(svc.startServer()).rejects.toMatchObject({ statusCode: 503 });
  });

  const sample = {
    cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 10_000, online_cpus: 2 },
    precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 8_000 },
    memory_stats: { usage: 1000, limit: 4000, stats: { inactive_file: 200 } },
  };

  it('stats computes cpu and memory (minus cache)', async () => {
    const docker = new FakeDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture(), sample));
    const st = await new DockerService(docker, 'mc', 'b').stats();
    expect(st.cpuPercent).toBeCloseTo(100);
    expect(st.memUsed).toBe(800);
    expect(st.memLimit).toBe(4000);
  });

  it('stats returns nulls when the container is missing, stats throw, or docker is down', async () => {
    const nulls = { cpuPercent: null, memUsed: null, memLimit: null };
    expect(await new DockerService(new FakeDocker(), 'mc', 'b').stats()).toEqual(nulls);
    const docker = new FakeDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture()));
    expect(await new DockerService(docker, 'mc', 'b').stats()).toEqual(nulls);
    docker.findByName = async () => { throw new Error('socket down'); };
    expect(await new DockerService(docker, 'mc', 'b').stats()).toEqual(nulls);
  });

  it('logStream returns the container stream and the tty flag', async () => {
    const docker = new FakeDocker();
    const c = new FakeContainer(inspectFixture({ Tty: true }));
    docker.containers.set('mc', c);
    const r = await new DockerService(docker, 'mc', 'b').logStream(100);
    expect(r.stream).toBe(c.logsStream);
    expect(r.tty).toBe(true);
  });

  it('execBackup runs the command and wait() resolves to the exit code after the stream ends', async () => {
    const docker = new FakeDocker();
    const b = new FakeContainer(inspectFixture(), undefined, undefined, undefined, 3);
    docker.containers.set('b', b);
    const r = await new DockerService(docker, 'mc', 'b').execBackup(['backup', 'now']);
    expect(b.calls).toEqual(['exec:backup now']);
    r.stream.resume();
    const w = r.wait();
    (b.execStream as PassThrough).end();
    expect(await w).toBe(3);
  });

  it('execBackup throws 503 when the backup container is missing', async () => {
    await expect(new DockerService(new FakeDocker(), 'mc', 'b').execBackup(['x'])).rejects.toMatchObject({ statusCode: 503 });
  });

  it('demux delegates to DockerLike.demux', () => {
    const docker = new FakeDocker();
    const spy = vi.spyOn(docker, 'demux');
    const src = new PassThrough();
    const out = new PassThrough();
    new DockerService(docker, 'mc', 'b').demux(src, out);
    expect(spy).toHaveBeenCalledWith(src, out, out);
  });
});

describe('DockerService reconnection', () => {
  afterEach(() => { vi.useRealTimers(); });

  class FlakyDocker extends FakeDocker {
    eventCalls = 0;
    failNext = false;
    streams: PassThrough[] = [];
    async events(): Promise<Readable> {
      this.eventCalls++;
      if (this.failNext) throw new Error('socket down');
      const s = new PassThrough();
      this.streams.push(s);
      return s as unknown as Readable;
    }
  }

  it('goes unavailable on disconnect then resyncs the real status after reconnect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const docker = new FlakyDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture()));
    const svc = new DockerService(docker, 'mc', 'b');
    const seen: string[] = [];
    svc.on('status', (s) => seen.push(s));
    await svc.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.getStatus()).toBe('ready');
    docker.failNext = true;
    docker.streams[0].destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.getStatus()).toBe('unavailable');
    docker.failNext = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(docker.eventCalls).toBe(2);
    expect(svc.getStatus()).toBe('ready');
    expect(seen).toEqual(['unavailable', 'ready']);
    svc.stop();
  });

  it('stop() during backoff clears the timer and makes no further events() call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const docker = new FlakyDocker();
    docker.failNext = true;
    const svc = new DockerService(docker, 'mc', 'b');
    await svc.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(docker.eventCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    svc.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(docker.eventCalls).toBe(1);
  });

  it('stop() while events() is pending destroys the late stream', async () => {
    const docker = new FakeDocker();
    let release!: (s: Readable) => void;
    docker.events = () => new Promise<Readable>((r) => { release = r; });
    const svc = new DockerService(docker, 'mc', 'b');
    await svc.start();
    svc.stop();
    const late = new PassThrough();
    release(late as unknown as Readable);
    await wait(10);
    expect(late.destroyed).toBe(true);
  });
});
