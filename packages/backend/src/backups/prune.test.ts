import { describe, it, expect } from 'vitest';
import type { BackupEntry, BackupSettings } from '@mc/common';
import { pruneCandidates, retentionDays } from './prune.js';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const DAY = 86_400_000;
const entry = (name: string, ageMs: number): BackupEntry => ({ name, size: 1, modifiedAt: new Date(NOW - ageMs).toISOString() });
const settings = (pruneDays: BackupSettings['pruneDays']): BackupSettings => ({
  containerFound: pruneDays !== null, running: true, managed: true, cronSchedule: null, interval: { value: '6h', source: 'compose' },
  pruneDays, pendingRestart: false, initialDelay: '2m', backupOnStartup: true,
});
/** Erreur levée par fn (toThrow ne compare pas statusCode/code). */
const thrown = (fn: () => unknown): unknown => { try { fn(); } catch (e) { return e; } return undefined; };

describe('pruneCandidates', () => {
  it('returns the archives older than the retention, newest first list in, newest always kept', () => {
    const list = [entry('a.tgz', 1 * DAY), entry('b.tar.gz', 8 * DAY), entry('c.tgz', 30 * DAY)];
    expect(pruneCandidates(list, 7, NOW).map((e) => e.name)).toEqual(['b.tar.gz', 'c.tgz']);
  });
  it('never returns the most recent archive, even when it is older than the retention', () => {
    const list = [entry('a.tgz', 10 * DAY), entry('b.tgz', 20 * DAY)];
    expect(pruneCandidates(list, 7, NOW).map((e) => e.name)).toEqual(['b.tgz']);
    expect(pruneCandidates([entry('only.tgz', 99 * DAY)], 7, NOW)).toEqual([]);
  });
  it('keeps an archive exactly at the limit (mc-backup prunes strictly older ones)', () => {
    const list = [entry('a.tgz', 0), entry('b.tgz', 7 * DAY)];
    expect(pruneCandidates(list, 7, NOW)).toEqual([]);
  });
  it('returns nothing for an empty list', () => expect(pruneCandidates([], 7, NOW)).toEqual([]));
});

describe('retentionDays', () => {
  it('reads the effective retention shown on the page', () => {
    expect(retentionDays(settings({ value: '14', source: 'file' }))).toBe(14);
    expect(retentionDays(settings({ value: '7', source: 'default' }))).toBe(7);
  });
  it('is 409 retention_unknown without the backup container', () => {
    expect(thrown(() => retentionDays(settings(null)))).toMatchObject({ statusCode: 409, code: 'retention_unknown' });
  });
  it.each(['0', '7d', '', '-1'])('is 409 retention_disabled when mc-backup would not prune by age (%j)', (v) => {
    expect(thrown(() => retentionDays(settings({ value: v, source: 'compose' })))).toMatchObject({ statusCode: 409, code: 'retention_disabled' });
  });
});
