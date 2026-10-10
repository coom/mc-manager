import { describe, it, expect } from 'vitest';
import { ITZG_ENV, ALWAYS_LOCKED, lockedKeys } from './itzg-env.js';

describe('itzg env table', () => {
  it('maps lowercase property keys to uppercase variables', () => {
    for (const [k, v] of Object.entries(ITZG_ENV)) { expect(k).toMatch(/^[a-z0-9.-]+$/); expect(v).toMatch(/^[A-Z0-9_]+$/); }
    expect(ITZG_ENV['motd']).toBe('MOTD');
    expect(ITZG_ENV['white-list']).toBe('ENABLE_WHITELIST');
    expect(ITZG_ENV['gamemode']).toBe('MODE');
    expect(ITZG_ENV['level-name']).toBe('LEVEL');
  });
  it('locks the keys whose variable is set, plus the RCON keys', () => {
    const locked = lockedKeys(['MOTD=hello', 'MAX_PLAYERS=10', 'TZ=Europe/Paris', 'EULA=TRUE']);
    expect(locked).toEqual({ motd: 'MOTD', 'max-players': 'MAX_PLAYERS', 'enable-rcon': 'rcon', 'rcon.port': 'rcon', 'rcon.password': 'rcon' });
  });
  it('ignores the env when OVERRIDE_SERVER_PROPERTIES=false, keeping only the RCON keys', () => {
    expect(lockedKeys(['MOTD=hello', 'OVERRIDE_SERVER_PROPERTIES=false'])).toEqual(Object.fromEntries(ALWAYS_LOCKED.map((k) => [k, 'rcon'])));
    expect(lockedKeys(['MOTD=hello', 'OVERRIDE_SERVER_PROPERTIES=FALSE'])['motd']).toBeUndefined();
  });
  it('treats an empty variable as unset', () => {
    expect(lockedKeys(['MOTD='])['motd']).toBeUndefined();
  });
});
