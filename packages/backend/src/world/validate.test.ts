import { describe, it, expect } from 'vitest';
import { assertPreset, assertWeather, assertDifficulty, assertGamemode, assertTick, assertGamerule } from './validate.js';

const bad = (fn: () => unknown) => expect(fn).toThrowError(expect.objectContaining({ statusCode: 400 }));

describe('world validators', () => {
  it('accepts catalogue values only', () => {
    expect(assertPreset('day')).toBe('day'); bad(() => assertPreset('dawn')); bad(() => assertPreset(1));
    expect(assertWeather('thunder')).toBe('thunder'); bad(() => assertWeather('snow'));
    expect(assertDifficulty('hard')).toBe('hard'); bad(() => assertDifficulty('Hard'));
    expect(assertGamemode('spectator')).toBe('spectator'); bad(() => assertGamemode('hardcore'));
  });
  it('validates tick updates: one field, bounded', () => {
    expect(assertTick({ rate: 40 })).toEqual({ rate: 40 });
    expect(assertTick({ rate: 12.5 })).toEqual({ rate: 12.5 });
    expect(assertTick({ frozen: true })).toEqual({ frozen: true });
    expect(assertTick({ sprint: 1200 })).toEqual({ sprint: 1200 });
    bad(() => assertTick({ rate: 0 })); bad(() => assertTick({ rate: 10001 })); bad(() => assertTick({ rate: '40' })); bad(() => assertTick({ rate: NaN }));
    bad(() => assertTick({ frozen: 'yes' }));
    bad(() => assertTick({ sprint: 0 })); bad(() => assertTick({ sprint: 72001 })); bad(() => assertTick({ sprint: 1.5 }));
    bad(() => assertTick({ rate: 20, frozen: true })); bad(() => assertTick({})); bad(() => assertTick(null));
  });
  it('validates gamerules against the catalogue, by type and bounds', () => {
    expect(assertGamerule('keep_inventory', true)).toMatchObject({ name: 'keep_inventory', value: true });
    expect(assertGamerule('random_tick_speed', 100)).toMatchObject({ name: 'random_tick_speed', value: 100 });
    bad(() => assertGamerule('keep_inventory', 'true'));
    bad(() => assertGamerule('random_tick_speed', '5'));
    bad(() => assertGamerule('random_tick_speed', 5.5));
    bad(() => assertGamerule('random_tick_speed', -1));
    bad(() => assertGamerule('random_tick_speed', 4097));
    bad(() => assertGamerule('random_tick_speed', true));
    bad(() => assertGamerule('notARule', true));
    bad(() => assertGamerule('keep_inventory; say hi', true));
  });
});
