import { describe, it, expect } from 'vitest';
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

  it('throws a 503 AppError when the container is missing', async () => {
    const svc = new DockerService(new FakeDocker(), 'mc', 'mc-backup');
    await expect(svc.startServer()).rejects.toMatchObject({ statusCode: 503 });
  });
});
