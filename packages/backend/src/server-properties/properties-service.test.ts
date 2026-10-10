import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PropertiesService } from './properties-service.js';
import { DataLock } from '../data/data-lock.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

describe('PropertiesService', () => {
  let dir: string; let docker: FakeDocker; let svc: DockerService; let lock: DataLock;
  const text = '#header\nmotd=Hello\nmax-players=20\nrcon.password=secret\nenable-rcon=true\n';
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-props-'));
    writeFileSync(path.join(dir, 'server.properties'), text);
    docker = new FakeDocker();
    docker.containers.set('mc', new FakeContainer(inspectFixture({ Env: ['MOTD=Hello', 'EULA=TRUE'] })));
    svc = new DockerService(docker, 'mc', 'mc-backup');
    await svc.start();
    lock = new DataLock();
  });
  afterEach(() => { svc.stop(); rmSync(dir, { recursive: true, force: true }); });
  const service = () => new PropertiesService({ dataDir: dir, docker: svc, lock });

  it('reads the file with the RCON password masked and env-locked keys', async () => {
    const v = await service().read();
    expect(v.exists).toBe(true);
    expect(v.raw).toContain('rcon.password=********');
    expect(v.raw).not.toContain('secret');
    expect(v.values['rcon.password']).toBe('********');
    expect(v.values.motd).toBe('Hello');
    expect(v.locked).toEqual({ motd: 'MOTD', 'enable-rcon': 'rcon', 'rcon.port': 'rcon', 'rcon.password': 'rcon' });
    expect(v.restartRequired).toBe(false);
  });
  it('reports a missing file without throwing', async () => {
    rmSync(path.join(dir, 'server.properties'));
    const v = await service().read();
    expect(v).toMatchObject({ exists: false, raw: '', values: {} });
  });
  it('writes values atomically, keeps the password, audits the changed keys and flags a restart', async () => {
    const { changed, view } = await service().write({ values: { 'max-players': '10', 'view-distance': '8', 'rcon.password': '********' } });
    expect(changed).toEqual(['max-players', 'view-distance']);
    const file = readFileSync(path.join(dir, 'server.properties'), 'utf8');
    expect(file).toContain('max-players=10');
    expect(file).toContain('rcon.password=secret');
    expect(readdirSync(dir).filter((f) => f.startsWith('.server.properties'))).toEqual([]);
    expect(view.restartRequired).toBe(true);
  });
  it('refuses a locked key with a different value (409) and accepts it unchanged', async () => {
    await expect(service().write({ values: { motd: 'Other' } })).rejects.toMatchObject({ statusCode: 409, message: 'Key motd is managed by MOTD' });
    await expect(service().write({ values: { 'rcon.port': '1' } })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service().write({ values: { motd: 'Hello', 'max-players': '5' } })).resolves.toMatchObject({ changed: ['max-players'] });
  });
  it('validates keys and values', async () => {
    await expect(service().write({ values: { 'Bad Key': 'x' } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service().write({ values: { motd2: 'a\nb' } })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('raw mode replaces the file, keeps the masked password as the real one, and refuses locked changes', async () => {
    await service().write({ raw: '# new\nmotd=Hello\nmax-players=3\nrcon.password=********\nenable-rcon=true\n' });
    const file = readFileSync(path.join(dir, 'server.properties'), 'utf8');
    expect(file).toBe('# new\nmotd=Hello\nmax-players=3\nrcon.password=secret\nenable-rcon=true\n');
    await expect(service().write({ raw: 'motd=Changed\n' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service().write({ raw: 'MOTD=x\n' })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('is refused while the data lock is held', async () => {
    const release = lock.acquire('restore');
    await expect(service().write({ values: { 'max-players': '1' } })).rejects.toMatchObject({ statusCode: 409 });
    release();
  });
  it('restartRequired resets when the server restarts after the write', async () => {
    const s = service();
    await s.write({ values: { 'max-players': '2' } });
    expect((await s.read()).restartRequired).toBe(true);
    docker.containers.set('mc', new FakeContainer(inspectFixture({ StartedAt: new Date(Date.now() + 60_000).toISOString() })));
    expect((await s.read()).restartRequired).toBe(false);
  });
  it('explains an EACCES with the path and the chown command', async () => {
    if (process.platform === 'win32') return; // chmod n'empêche pas l'écriture sous Windows
    chmodSync(dir, 0o500);
    const err = await service().write({ values: { 'max-players': '1' } }).catch((e) => e);
    chmodSync(dir, 0o700);
    expect(err.statusCode).toBe(500);
    expect(err.message).toMatch(/chown -R 1000:1000/);
  });
});
