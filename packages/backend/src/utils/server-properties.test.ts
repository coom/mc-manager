import { describe, it, expect } from 'vitest';
import { parseServerProperties, rconSettings, escapeValue, updateServerProperties, validateRawProperties, maskRconPassword } from './server-properties.js';

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

describe('updateServerProperties', () => {
  const text = '#Minecraft server properties\n#Fri Oct 10 10:00:00 UTC 2026\nmotd=A Minecraft Server\nmax-players=20\nrcon.password=secret\nwhite-list=false\n';
  it('replaces values in place, keeps comments, order and unknown lines, appends new keys', () => {
    const out = updateServerProperties(text, { motd: 'Hello=World', 'max-players': '10', 'view-distance': '12' });
    expect(out).toBe('#Minecraft server properties\n#Fri Oct 10 10:00:00 UTC 2026\nmotd=Hello\\=World\nmax-players=10\nrcon.password=secret\nwhite-list=false\nview-distance=12\n');
    expect(parseServerProperties(out)).toMatchObject({ motd: 'Hello=World', 'max-players': '10', 'view-distance': '12', 'rcon.password': 'secret' });
  });
  it('handles colon separators and a file without trailing newline', () => {
    expect(updateServerProperties('a:1\nb=2', { a: '9' })).toBe('a=9\nb=2\n');
  });
  it('round-trips escaped values', () => {
    const v = 'C:\\path #hash !bang \u00e9t\u00e9';
    expect(parseServerProperties(`k=${escapeValue(v)}\n`).k).toBe(v);
    for (const w of [' leading space', 'a\rb', 'a\r\nb\tc']) expect(parseServerProperties(`k=${escapeValue(w)}\n`).k).toBe(w);
  });
  it('drops later duplicates of an updated key so the new value wins', () => {
    const out = updateServerProperties('a=1\nb=2\na=3\n', { a: '9' });
    expect(out).toBe('a=9\nb=2\n');
    expect(parseServerProperties(out).a).toBe('9');
    expect(updateServerProperties('a=1\nb=2\nb=3\n', { a: '9' })).toBe('a=9\nb=2\nb=3\n');
  });
});

describe('validateRawProperties', () => {
  it('accepts comments, blank lines and key=value / key:value', () => {
    expect(validateRawProperties('# c\n\nmotd=x\nlevel-name:world\n')).toBeNull();
  });
  it.each([['no separator', 'motd'], ['bad key', 'Motd=x'], ['bad key 2', 'a b=c']])('rejects %s', (_l, t) => {
    expect(validateRawProperties(t)).toMatch(/line 1/);
  });
  it('rejects oversized content', () => {
    expect(validateRawProperties('k=' + 'x'.repeat(70 * 1024))).toMatch(/64 KiB/);
  });
  it('rejects a Java line continuation (odd number of trailing backslashes)', () => {
    expect(validateRawProperties('rcon.password=attacker\nmotd=x\\\nrcon.password=********\n'))
      .toBe('Invalid line 2: line continuation (trailing backslash) is not allowed');
    expect(validateRawProperties('motd=a\\\\\\')).toMatch(/line 1: line continuation/);
  });
  it('accepts an escaped backslash at the end of a line and a backslash in a comment', () => {
    expect(validateRawProperties('motd=a\\\\\n# comment \\\nlevel-name=world\n')).toBeNull();
  });
  it('values written through escapeValue never end with a continuation', () => {
    const text = updateServerProperties('motd=x\nrcon.password=s\n', { motd: 'ends with \\' });
    expect(validateRawProperties(text)).toBeNull();
    expect(parseServerProperties(text)).toEqual({ motd: 'ends with \\', 'rcon.password': 's' });
  });
});

describe('maskRconPassword', () => {
  it('masks the value whatever the separator and keeps the rest', () => {
    expect(maskRconPassword('a=1\nrcon.password=s3cr3t\nrcon.port:25575\n')).toBe('a=1\nrcon.password=********\nrcon.port:25575\n');
    expect(maskRconPassword('a=1\n')).toBe('a=1\n');
  });
  it('masks every occurrence', () => {
    expect(maskRconPassword('rcon.password=a\nx=1\nrcon.password:b\n')).toBe('rcon.password=********\nx=1\nrcon.password:********\n');
  });
});
