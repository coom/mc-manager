import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { BACKUP_INTERVAL_FILE_RE, BACKUP_SETTINGS_COMPOSE_SNIPPET, PRUNE_DAYS_FILE_RE, intervalToMinutes } from '@mc/common';
import { SETTINGS_RELATIVE, effectiveSettings, isManaged, parseSettingsFile, serializeSettings, validateUpdate } from './backup-settings.js';

const EP = ['/bin/bash', '-c', 'f=/backups/.mc-manager/backup-settings.conf\nexec /usr/bin/backup loop'];
/** Erreur levée par fn (toThrow ne compare pas les propriétés statusCode/code). */
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } return undefined; };

describe('intervalToMinutes', () => {
  it.each<[string, number]>([['30m', 30], ['6h', 360], ['7d', 10080], ['90s', 1.5], ['21600', 360]])('%s → %d', (v, n) => expect(intervalToMinutes(v)).toBe(n));
  it.each(['', '1.5h', '6 h', '-1h', 'h', '6w'])('rejects %j', (v) => expect(intervalToMinutes(v)).toBeNull());
});

describe('isManaged', () => {
  it('detects the settings path in an array entrypoint', () => expect(isManaged(EP, null)).toBe(true));
  it('detects it in a string entrypoint or in cmd', () => {
    expect(isManaged(EP.join(' '), undefined)).toBe(true);
    expect(isManaged(null, ['bash', '-c', 'cat /srv/b/.mc-manager/backup-settings.conf'])).toBe(true);
  });
  it('is false for the default image entrypoint', () => {
    expect(isManaged(['/usr/bin/backup'], ['loop'])).toBe(false);
    expect(isManaged(null, null)).toBe(false);
  });
});

describe('parseSettingsFile', () => {
  it('reads both keys', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\nPRUNE_BACKUPS_DAYS=7\n')).toEqual({ interval: '6h', pruneDays: '7' }));
  it('ignores unknown keys, invalid values and spaces like the compose script', () => {
    expect(parseSettingsFile('FOO=1\nBACKUP_INTERVAL=0h\nPRUNE_BACKUPS_DAYS= 7\nBACKUP_INTERVAL =6h\n')).toEqual({});
  });
  it('keeps a single valid key', () => expect(parseSettingsFile('PRUNE_BACKUPS_DAYS=14\n')).toEqual({ pruneDays: '14' }));
  it('rejects a CRLF value (read keeps the \\r)', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\r\n')).toEqual({}));
  it('ignores a last line without newline (read returns non-zero)', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\nPRUNE_BACKUPS_DAYS=7')).toEqual({ interval: '6h' }));
  it('keeps the last occurrence', () => expect(parseSettingsFile('BACKUP_INTERVAL=6h\nBACKUP_INTERVAL=12h\n')).toEqual({ interval: '12h' }));
  it('rejects shell injection attempts', () => expect(parseSettingsFile('BACKUP_INTERVAL=a[$(id)]\nPRUNE_BACKUPS_DAYS=$(id)\n')).toEqual({}));
  it('round-trips serializeSettings', () => expect(parseSettingsFile(serializeSettings({ interval: '6h', pruneDays: 7 }))).toEqual({ interval: '6h', pruneDays: '7' }));
});

describe('serializeSettings', () => {
  it('writes two LF-terminated lines', () => expect(serializeSettings({ interval: '30m', pruneDays: 365 })).toBe('BACKUP_INTERVAL=30m\nPRUNE_BACKUPS_DAYS=365\n'));
});

describe('validateUpdate', () => {
  it.each([[{ interval: '30m', pruneDays: 1 }], [{ interval: '7d', pruneDays: 365 }], [{ interval: '6h', pruneDays: 7 }]])('accepts %j', (b) => expect(validateUpdate(b)).toEqual(b));
  it.each([
    [{ interval: '29m', pruneDays: 7 }], [{ interval: '8d', pruneDays: 7 }], [{ interval: '0h', pruneDays: 7 }],
    [{ interval: '6', pruneDays: 7 }], [{ interval: 6, pruneDays: 7 }], [{ interval: '06h', pruneDays: 7 }],
    [{ interval: '6h', pruneDays: 0 }], [{ interval: '6h', pruneDays: 366 }], [{ interval: '6h', pruneDays: 1.5 }],
    [{ interval: '6h', pruneDays: '7' }], [{ interval: '6h' }], [null],
  ])('rejects %j with 400 invalid', (b) => {
    expect(thrown(() => validateUpdate(b))).toMatchObject({ statusCode: 400, code: 'invalid' });
  });
  it('returns only the two known fields', () => expect(validateUpdate({ interval: '6h', pruneDays: 7, extra: 1 })).toEqual({ interval: '6h', pruneDays: 7 }));
});

describe('effectiveSettings', () => {
  it('prefers the file, then the compose, then the image defaults', () => {
    expect(effectiveSettings({ interval: '12h' }, ['BACKUP_INTERVAL=6h', 'PRUNE_BACKUPS_DAYS=5'])).toEqual({
      interval: { value: '12h', source: 'file' }, pruneDays: { value: '5', source: 'compose' },
    });
    expect(effectiveSettings({}, [])).toEqual({ interval: { value: '24h', source: 'default' }, pruneDays: { value: '7', source: 'default' } });
  });
  it('falls back to INTERVAL_SEC and treats empty values as unset (":=" in the image)', () => {
    expect(effectiveSettings({}, ['BACKUP_INTERVAL=', 'INTERVAL_SEC=3600']).interval).toEqual({ value: '3600', source: 'compose' });
    expect(effectiveSettings({}, ['PRUNE_BACKUPS_DAYS=']).pruneDays).toEqual({ value: '7', source: 'default' });
  });
});

describe('compose snippet', () => {
  const inCompose = (re: RegExp) => `${re.source.slice(0, -1)}$$`;
  it('reads the settings file with the backend regexes', () => {
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).toContain(SETTINGS_RELATIVE);
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).toContain(`BACKUP_INTERVAL) [[ "$$v" =~ ${inCompose(BACKUP_INTERVAL_FILE_RE)} ]]`);
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).toContain(`PRUNE_BACKUPS_DAYS) [[ "$$v" =~ ${inCompose(PRUNE_DAYS_FILE_RE)} ]]`);
    expect(BACKUP_SETTINGS_COMPOSE_SNIPPET).not.toMatch(/\bsource\b|^\s*\.\s/m);
  });
  it('is detected as managed once installed', () => expect(isManaged(BACKUP_SETTINGS_COMPOSE_SNIPPET, null)).toBe(true));
});

describe('documentation', () => {
  const root = (f: string) => readFileSync(fileURLToPath(new URL(`../../../../${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  it('docker-compose.example.yml and the README carry the exact compose snippet', () => {
    expect(root('docker-compose.example.yml')).toContain(BACKUP_SETTINGS_COMPOSE_SNIPPET);
    expect(root('README.md')).toContain(BACKUP_SETTINGS_COMPOSE_SNIPPET);
  });
});
