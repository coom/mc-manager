import { describe, it, expect } from 'vitest';
import { isUnknownCommand, parseTimeQuery, parseTimelinePosition, parseTimelineRepetitions, parseGamerule, parseDifficulty, parseTickStatus } from './parsers.js';

describe('world parsers', () => {
  it('detects an unknown command, with or without colours', () => {
    expect(isUnknownCommand('Unknown or incomplete command, see below for error\ntick query<--[HERE]')).toBe(true);
    expect(isUnknownCommand('§cUnknown command')).toBe(true);
    expect(isUnknownCommand('Target tick rate: 20.0 per second.')).toBe(false);
    expect(isUnknownCommand('')).toBe(false);
  });
  it('parses time queries', () => {
    expect(parseTimeQuery('The time is 6000')).toBe(6000);
    expect(parseTimeQuery('§eThe time is §f12')).toBe(12);
    expect(parseTimeQuery('Unknown or incomplete command')).toBeNull();
    expect(parseTimeQuery('')).toBeNull();
  });
  it('parses the 1.21.11+ timeline replies of time query', () => {
    expect(parseTimelinePosition('Timeline minecraft:day is at 9223 tick(s)')).toBe(9223);
    expect(parseTimelinePosition('The time is 6000')).toBeNull();
    expect(parseTimelinePosition("Can't find element 'minecraft:daytime' of type 'minecraft:timeline'")).toBeNull();
    expect(parseTimelineRepetitions('Timeline minecraft:day has passed 12 repetition(s)')).toBe(12);
    expect(parseTimelineRepetitions('Timeline minecraft:day is at 9223 tick(s)')).toBeNull();
  });
  it('parses gamerule reads and writes', () => {
    // 1.21.11+ : « Game rule » en deux mots, sans deux-points.
    expect(parseGamerule('Game rule keep_inventory is currently set to false')).toBe(false);
    expect(parseGamerule('Game rule random_tick_speed is now set to 10')).toBe(10);
    expect(parseGamerule('Gamerule keep_inventory is currently set to: false')).toBe(false);
    expect(parseGamerule('Gamerule keep_inventory is now set to: true')).toBe(true);
    expect(parseGamerule('Gamerule random_tick_speed is currently set to: 3')).toBe(3);
    expect(parseGamerule('Gamerule respawn_radius is now set to: 0')).toBe(0);
    expect(parseGamerule('Gamerule minecraft:keep_inventory is currently set to: false')).toBe(false);
    expect(parseGamerule('Gamerule advance_time is now set to: true')).toBe(true);
    expect(parseGamerule('Unknown or incomplete command')).toBeNull();
    expect(parseGamerule('Incorrect argument for command\ngamerule keepInventory<--[HERE]')).toBeNull();
    expect(parseGamerule('Gamerule foo is currently set to: maybe')).toBeNull();
  });
  it('parses the difficulty in lowercase and rejects unknown values', () => {
    expect(parseDifficulty('The difficulty is Normal')).toBe('normal');
    expect(parseDifficulty('§aThe difficulty is Peaceful')).toBe('peaceful');
    expect(parseDifficulty('The difficulty is Brutal')).toBeNull();
    expect(parseDifficulty('')).toBeNull();
  });
  it('parses tick status when running, frozen or sprinting', () => {
    expect(parseTickStatus('Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)\nPercentiles: P50: 2.9ms P95: 5.1ms P99: 9.0ms, sample: 100'))
      .toEqual({ targetRate: 20, frozen: false, sprinting: false });
    expect(parseTickStatus('The game is frozen\nTarget tick rate: 40.0 per second.\nAverage time per tick: 0.1ms'))
      .toEqual({ targetRate: 40, frozen: true, sprinting: false });
    expect(parseTickStatus('The game is sprinting\nTarget tick rate: 20.0 per second.'))
      .toEqual({ targetRate: 20, frozen: false, sprinting: true });
    // RCON vanilla colle les deux messages sans séparateur (MC-7569) : pas de limite de mot entre « frozen » et « Target ».
    expect(parseTickStatus('The game is frozenTarget tick rate: 20.0 per second.\nAverage time per tick: 0.1ms'))
      .toEqual({ targetRate: 20, frozen: true, sprinting: false });
    expect(parseTickStatus('The game is sprintingTarget tick rate: 20.0 per second.'))
      .toEqual({ targetRate: 20, frozen: false, sprinting: true });
    // Ligne de taux absente : l'état est quand même rendu.
    expect(parseTickStatus('The game is frozen')).toEqual({ targetRate: null, frozen: true, sprinting: false });
    expect(parseTickStatus('§aTarget tick rate: §f12.5§a per second.')?.targetRate).toBe(12.5);
    expect(parseTickStatus('Unknown or incomplete command')).toBeNull();
    expect(parseTickStatus('')).toBeNull();
  });
});
