import { describe, it, expect } from 'vitest';
import { parseList, parseTickQuery, parseTps, stripColors } from './parsers.js';

describe('parseList', () => {
  it('parses players', () => expect(parseList('There are 2 of a max of 20 players online: Alice, Bob')).toEqual({ online: 2, max: 20, names: ['Alice', 'Bob'] }));
  it('parses empty', () => expect(parseList('There are 0 of a max of 20 players online: ')).toEqual({ online: 0, max: 20, names: [] }));
  it('returns null on garbage', () => expect(parseList('Unknown or incomplete command')).toBeNull());
});

describe('parseTickQuery', () => {
  it('parses 1.20.3+ output', () => {
    expect(parseTickQuery('Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)\nPercentiles: P50: 2.9ms P95: 5.1ms P99: 9.0ms, sample: 100')).toEqual({ mspt: 3.2, targetRate: 20 });
  });
  it('returns null when the command is unknown (pre-1.20.3)', () => expect(parseTickQuery('Unknown or incomplete command, see below for error')).toBeNull());
  it('ignores colour codes', () => expect(parseTickQuery('§aTarget tick rate: §f20.0§a per second.\n§aAverage time per tick: §f1.5ms')?.mspt).toBe(1.5));
});

describe('parseTps', () => {
  it('parses Paper output', () => expect(parseTps('§6TPS from last 1m, 5m, 15m: §a*20.0, §a20.0, §a19.98')).toBe(20));
  it('returns null otherwise', () => expect(parseTps('Unknown command')).toBeNull());
});

it('stripColors removes § sequences', () => expect(stripColors('§aok§r')).toBe('ok'));
