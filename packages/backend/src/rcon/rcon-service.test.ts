import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { RconService } from './rcon-service.js';
import type { RconLike, RconConnection } from './rcon-like.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeConn extends EventEmitter implements RconConnection {
  sent: string[] = [];
  async send(cmd: string) { this.sent.push(cmd); return `ok:${cmd}`; }
  end() { this.emit('end'); }
}

function setup(status: 'ready' | 'stopped' | 'unhealthy' = 'ready') {
  const docker = new FakeDocker();
  const state = status === 'stopped' ? { Status: 'exited', Running: false } : status === 'unhealthy' ? { Health: { Status: 'unhealthy' as const } } : {};
  docker.containers.set('mc', new FakeContainer(inspectFixture(state)));
  const svc = new DockerService(docker, 'mc', 'mc-backup');
  const conns: FakeConn[] = [];
  const rconLib: RconLike = { connect: vi.fn(async () => { const c = new FakeConn(); conns.push(c); return c; }) };
  const credentials = vi.fn(async () => ({ enabled: true, port: 25575, password: 'pw' }));
  const rcon = new RconService(rconLib, svc, { host: 'mc', portFallback: 25575 }, credentials);
  return { docker, svc, rcon, rconLib, conns, credentials };
}

describe('RconService', () => {
  it('connects only when the server is ready and sends commands sequentially', async () => {
    const { svc, rcon, conns } = setup();
    await svc.start(); await rcon.start(); await wait(10);
    expect(conns).toHaveLength(1);
    const [a, b] = await Promise.all([rcon.send('list'), rcon.send('tps')]);
    expect(a).toBe('ok:list'); expect(b).toBe('ok:tps');
    expect(conns[0].sent).toEqual(['list', 'tps']);
    rcon.stop(); svc.stop();
  });

  it('does not connect while stopped and rejects send with 503', async () => {
    const { svc, rcon, rconLib } = setup('stopped');
    await svc.start(); await rcon.start(); await wait(10);
    expect(rconLib.connect).not.toHaveBeenCalled();
    await expect(rcon.send('list')).rejects.toMatchObject({ statusCode: 503 });
    rcon.stop(); svc.stop();
  });

  it('reconnects with backoff after the connection ends', async () => {
    const { svc, rcon, conns } = setup();
    await svc.start(); await rcon.start(); await wait(10);
    conns[0].end();
    await wait(1100);
    expect(conns).toHaveLength(2);
    rcon.stop(); svc.stop();
  });

  function pendingSetup() {
    const s = setup();
    const conn = new FakeConn();
    const endSpy = vi.spyOn(conn, 'end');
    let release!: () => void;
    (s.rconLib.connect as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((r) => { release = () => r(conn); }));
    return { ...s, conn, endSpy, release: () => release() };
  }

  it('discards a connection that completes after stop()', async () => {
    const { svc, rcon, conn, endSpy, release } = pendingSetup();
    await svc.start();
    const started = rcon.start(); await wait(10);
    rcon.stop();
    release(); await started; await wait(10);
    expect(rcon.isConnected()).toBe(false);
    expect(endSpy).toHaveBeenCalled();
    expect(conn.listenerCount('end')).toBe(0);
    svc.stop();
  });

  it('discards a connection that completes after the server left ready', async () => {
    const { svc, rcon, endSpy, release } = pendingSetup();
    await svc.start();
    const started = rcon.start(); await wait(10);
    (svc as unknown as { setStatus(s: string): void }).setStatus('stopping');
    release(); await started; await wait(10);
    expect(rcon.isConnected()).toBe(false);
    expect(endSpy).toHaveBeenCalled();
    rcon.stop(); svc.stop();
  });

  it('reads the password from server.properties, refusing when rcon is disabled', async () => {
    const { svc, rcon, credentials, rconLib } = setup();
    credentials.mockResolvedValueOnce({ enabled: false, port: 25575, password: null });
    await svc.start(); await rcon.start(); await wait(10);
    expect(rconLib.connect).not.toHaveBeenCalled();
    rcon.stop(); svc.stop();
  });

  it('connects when the server starts unhealthy', async () => {
    const { svc, rcon, conns } = setup('unhealthy');
    await svc.start(); await rcon.start(); await wait(10);
    expect(svc.getStatus()).toBe('unhealthy');
    expect(conns).toHaveLength(1);
    expect(rcon.isConnected()).toBe(true);
    rcon.stop(); svc.stop();
  });

  it('keeps the connection when the server goes from ready to unhealthy', async () => {
    const { docker, svc, rcon, conns } = setup();
    await svc.start(); await rcon.start(); await wait(10);
    const endSpy = vi.spyOn(conns[0], 'end');
    docker.containers.get('mc')!.state = inspectFixture({ Health: { Status: 'unhealthy' } });
    docker.emitEvent({ Action: 'health_status: unhealthy', name: 'mc' });
    await wait(10);
    expect(svc.getStatus()).toBe('unhealthy');
    expect(rcon.isConnected()).toBe(true);
    expect(endSpy).not.toHaveBeenCalled();
    rcon.stop(); svc.stop();
  });

  it('does not reconnect during a stop even if the container still inspects healthy', async () => {
    const { docker, svc, rcon, conns, rconLib } = setup();
    await svc.start(); await rcon.start(); await wait(10);
    const c = docker.containers.get('mc')!;
    const release = c.holdOps();
    const p = svc.stopServer();
    await wait(10);
    expect(rcon.isConnected()).toBe(false);
    docker.emitEvent({ Action: 'kill', name: 'mc' });
    await wait(10);
    expect(rconLib.connect).toHaveBeenCalledTimes(1);
    expect(conns).toHaveLength(1);
    c.state = inspectFixture({ Status: 'exited', Running: false });
    release(); await p; await wait(10);
    expect(rcon.isConnected()).toBe(false);
    rcon.stop(); svc.stop();
  });
});
