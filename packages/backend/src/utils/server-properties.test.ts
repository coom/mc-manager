import { describe, it, expect } from 'vitest';
import { parseServerProperties, rconSettings } from './server-properties.js';

const SAMPLE = `#Minecraft server properties
#Fri Oct 10 10:00:00 UTC 2026
enable-rcon=true
rcon.port=25575
rcon.password=s3cret\\=with\\:escapes
motd=A Minecraft Server \\u00e9t\\u00e9
max-players=20
empty=
`;

describe('parseServerProperties', () => {
  it('ignores comments and parses key=value', () => {
    const p = parseServerProperties(SAMPLE);
    expect(p['enable-rcon']).toBe('true');
    expect(p['max-players']).toBe('20');
    expect(p['empty']).toBe('');
  });
  it('unescapes backslash sequences and \\uXXXX', () => {
    const p = parseServerProperties(SAMPLE);
    expect(p['rcon.password']).toBe('s3cret=with:escapes');
    expect(p['motd']).toBe('A Minecraft Server été');
  });
});

describe('rconSettings', () => {
  it('reads enabled, port and password', () => {
    expect(rconSettings(parseServerProperties(SAMPLE))).toEqual({ enabled: true, port: 25575, password: 's3cret=with:escapes' });
  });
  it('defaults when keys are absent', () => {
    expect(rconSettings({})).toEqual({ enabled: false, port: 25575, password: null });
  });
});
