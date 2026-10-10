import { describe, it, expect } from 'vitest';
import { buildMcConfig } from './config.js';

describe('buildMcConfig', () => {
  it('defaults rconHost to the container name and rconPort to 25575', () => {
    const mc = buildMcConfig({ MC_CONTAINER: 'mc', MC_BACKUP_CONTAINER: 'mc-backup' });
    expect(mc.rconHost).toBe('mc');
    expect(mc.rconPort).toBe(25575);
    expect(mc.dataDir).toBe('/mc/data');
    expect(mc.backupsDir).toBe('/mc/backups');
    expect(mc.dockerSocket).toBe('/var/run/docker.sock');
  });
  it('honours explicit overrides', () => {
    const mc = buildMcConfig({ MC_CONTAINER: 'srv', MC_BACKUP_CONTAINER: 'bk', MC_RCON_HOST: '10.0.0.2', MC_RCON_PORT: '25999', MC_DATA_DIR: '/d', MC_BACKUPS_DIR: '/b', DOCKER_SOCKET: '/x.sock' });
    expect(mc).toEqual({ container: 'srv', backupContainer: 'bk', rconHost: '10.0.0.2', rconPort: 25999, dataDir: '/d', backupsDir: '/b', dockerSocket: '/x.sock' });
  });
  it('throws when MC_CONTAINER is missing', () => {
    expect(() => buildMcConfig({ MC_BACKUP_CONTAINER: 'bk' })).toThrow(/MC_CONTAINER/);
  });
});
