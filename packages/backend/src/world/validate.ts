import { DIFFICULTIES, GAMEMODES, GAMERULES, TICK_RATE, TICK_SPRINT_MAX, TIME_PRESETS, WEATHER_KINDS, type Difficulty, type Gamemode, type TimePreset, type WeatherKind, type WorldTickUpdate } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw new AppError(400, `Invalid ${what}`);
  return v as T;
}
export const assertPreset = (v: unknown): TimePreset => oneOf(TIME_PRESETS, v, 'time preset');
export const assertWeather = (v: unknown): WeatherKind => oneOf(WEATHER_KINDS, v, 'weather');
export const assertDifficulty = (v: unknown): Difficulty => oneOf(DIFFICULTIES, v, 'difficulty');
export const assertGamemode = (v: unknown): Gamemode => oneOf(GAMEMODES, v, 'gamemode');

/** Exactement un champ parmi rate (1..10000, décimal accepté), frozen (booléen), sprint (entier 1..72000). */
export function assertTick(body: unknown): WorldTickUpdate {
  if (!body || typeof body !== 'object') throw new AppError(400, 'Body must contain rate, frozen or sprint');
  const b = body as Record<string, unknown>;
  const fields = ['rate', 'frozen', 'sprint'].filter((k) => k in b);
  if (fields.length !== 1) throw new AppError(400, 'Body must contain exactly one of rate, frozen or sprint');
  if (fields[0] === 'rate') {
    if (typeof b.rate !== 'number' || !Number.isFinite(b.rate) || b.rate < TICK_RATE.min || b.rate > TICK_RATE.max) throw new AppError(400, `rate must be a number between ${TICK_RATE.min} and ${TICK_RATE.max}`);
    return { rate: b.rate };
  }
  if (fields[0] === 'frozen') {
    if (typeof b.frozen !== 'boolean') throw new AppError(400, 'frozen must be a boolean');
    return { frozen: b.frozen };
  }
  if (!Number.isInteger(b.sprint) || (b.sprint as number) < 1 || (b.sprint as number) > TICK_SPRINT_MAX) throw new AppError(400, `sprint must be an integer between 1 and ${TICK_SPRINT_MAX}`);
  return { sprint: b.sprint as number };
}

/** Nom dans le catalogue, valeur du bon type et dans les bornes : rien d'autre n'atteint la console. */
export function assertGamerule(name: unknown, value: unknown): { name: string; value: boolean | number } {
  const def = typeof name === 'string' ? GAMERULES.find((g) => g.name === name) : undefined;
  if (!def) throw new AppError(400, 'Unknown gamerule');
  if (def.type === 'bool') {
    if (typeof value !== 'boolean') throw new AppError(400, `${def.name} must be a boolean`);
    return { name: def.name, value };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) {
    throw new AppError(400, `${def.name} must be an integer between ${def.min ?? '-∞'} and ${def.max ?? '∞'}`);
  }
  return { name: def.name, value };
}
