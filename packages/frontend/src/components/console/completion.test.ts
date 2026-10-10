import { applyCompletion, complete } from './completion';

const players = ['Alice', 'Bob', 'alfred'];

describe('complete', () => {
  it('completes command names on the first word, with or without leading slash', () => {
    expect(complete('ga', players).candidates).toEqual(['gamemode', 'gamerule']);
    expect(complete('/ga', players)).toMatchObject({ start: 1, word: 'ga', candidates: ['gamemode', 'gamerule'] });
    expect(complete('', players).candidates).toContain('give');
  });

  it('completes online players and selectors where a player is expected', () => {
    expect(complete('kick al', players).candidates).toEqual(['Alice', 'alfred']);
    expect(complete('tp Alice b', players).candidates).toEqual(['Bob']);
    expect(complete('give @', players).candidates).toEqual(['@a', '@e', '@p', '@r', '@s']);
  });

  it('completes items for give and clear, with optional minecraft: prefix', () => {
    const bare = complete('give Alice diamond_sw', players);
    expect(bare).toMatchObject({ start: 11, word: 'diamond_sw', candidates: ['diamond_sword'] });
    expect(complete('clear @a minecraft:diamond_sw', players).candidates).toEqual(['minecraft:diamond_sword']);
  });

  it('completes entities, effects, enchantments and blocks', () => {
    expect(complete('summon zombie_v', players).candidates).toEqual(['zombie_villager']);
    expect(complete('effect give Bob fire_', players).candidates).toEqual(['fire_resistance']);
    expect(complete('enchant Bob sharp', players).candidates).toEqual(['sharpness']);
    expect(complete('setblock ~ ~ ~ oak_pl', players).candidates).toEqual(['oak_planks']);
  });

  it('completes literal choices and branches on them', () => {
    expect(complete('gamemode ', players).candidates).toEqual(['adventure', 'creative', 'spectator', 'survival']);
    expect(complete('time set n', players).candidates).toEqual(['night', 'noon']);
    expect(complete('whitelist ad', players).candidates).toEqual(['add']);
    expect(complete('whitelist add B', players).candidates).toEqual(['Bob']);
  });

  it('suggests ~ for empty coordinates and nothing for unknown positions', () => {
    expect(complete('setblock ', players).candidates).toEqual(['~']);
    expect(complete('setblock 1', players).candidates).toEqual([]);
    expect(complete('xp add Bob 1', players).candidates).toEqual([]);
  });

  it('falls back to players for commands without a grammar', () => {
    expect(complete('execute as Ali', players).candidates).toEqual(['Alice']);
  });

  it('proposes nothing once the grammar is exhausted or on an unknown branch', () => {
    expect(complete('give Alice diamond ', players).candidates).toEqual([]);
    expect(complete('kick Alice ', players).candidates).toEqual([]);
    expect(complete('summon zombie ~ ~ ~ ', players).candidates).toEqual([]);
    expect(complete('time sett ', players).candidates).toEqual([]);
  });

  it('survives leading spaces and names inherited from Object.prototype', () => {
    expect(complete(' gi', players).candidates).toEqual(['give']);
    expect(complete('/ ', players).candidates).toContain('give');
    // Commandes inconnues, pas des entrées de GRAMMAR : repli sur les joueurs, surtout pas d'exception.
    expect(complete('constructor ', players).candidates).toContain('Alice');
    expect(complete('hasOwnProperty x', players).candidates).toEqual([]);
  });

  it('is case-insensitive on the prefix', () => {
    expect(complete('GIVE alice DIA', players).candidates[0]).toBe('diamond');
  });
});

describe('applyCompletion', () => {
  it('replaces the current word and appends a space', () => {
    const c = complete('give Al', players);
    expect(applyCompletion('give Al', c, 0)).toBe('give Alice ');
    expect(applyCompletion('give Al', c, 1)).toBe('give alfred ');
  });
});
