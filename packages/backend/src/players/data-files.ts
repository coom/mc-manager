import { readFile } from 'fs/promises';
import path from 'path';
import type { BannedIp, BannedPlayer, OpEntry, ServerLists, VanillaStats, WhitelistEntry } from '@mc/common';
import { readServerProperties } from '../utils/server-properties.js';
import { logger } from '../utils/logger.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string): boolean => UUID_RE.test(s);

/** Tableau JSON lu dans /data ; fichier absent → [], JSON invalide ou non-tableau → [] + warn. */
export async function readJsonArray<T>(dataDir: string, file: string): Promise<T[]> {
  let text: string;
  try { text = await readFile(path.join(dataDir, file), 'utf8'); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file }, 'cannot read data file');
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) { logger.warn({ file }, 'data file is not a JSON array'); return []; }
    return parsed as T[];
  } catch (err) { logger.warn({ err, file }, 'data file is not valid JSON'); return []; }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object';
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

export async function readLists(dataDir: string): Promise<ServerLists> {
  const [wl, ops, bp, bi, props] = await Promise.all([
    readJsonArray<unknown>(dataDir, 'whitelist.json'),
    readJsonArray<unknown>(dataDir, 'ops.json'),
    readJsonArray<unknown>(dataDir, 'banned-players.json'),
    readJsonArray<unknown>(dataDir, 'banned-ips.json'),
    readServerProperties(dataDir).catch(() => ({} as Record<string, string>)),
  ]);
  const whitelist: WhitelistEntry[] = wl.filter(isObj).filter((e) => str(e.uuid) && str(e.name)).map((e) => ({ uuid: str(e.uuid), name: str(e.name) }));
  const opEntries: OpEntry[] = ops.filter(isObj).filter((e) => str(e.uuid) && str(e.name))
    .map((e) => ({ uuid: str(e.uuid), name: str(e.name), level: typeof e.level === 'number' ? e.level : 0, bypassesPlayerLimit: e.bypassesPlayerLimit === true }));
  const bannedPlayers: BannedPlayer[] = bp.filter(isObj).filter((e) => str(e.name))
    .map((e) => ({ uuid: str(e.uuid), name: str(e.name), created: str(e.created), source: str(e.source), expires: str(e.expires) || 'forever', reason: str(e.reason) }));
  const bannedIps: BannedIp[] = bi.filter(isObj).filter((e) => str(e.ip))
    .map((e) => ({ ip: str(e.ip), created: str(e.created), source: str(e.source), expires: str(e.expires) || 'forever', reason: str(e.reason) }));
  return { whitelist, ops: opEntries, bannedPlayers, bannedIps, whitelistEnabled: props['white-list'] === 'true' };
}

export async function readUserCache(dataDir: string): Promise<{ name: string; uuid: string }[]> {
  const rows = await readJsonArray<unknown>(dataDir, 'usercache.json');
  return rows.filter(isObj).filter((e) => str(e.name) && isUuid(str(e.uuid))).map((e) => ({ name: str(e.name), uuid: str(e.uuid).toLowerCase() }));
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const sumValues = (section: unknown): number | null => {
  if (!isObj(section)) return null;
  const vals = Object.values(section).map(num).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

export function parseVanillaStats(json: unknown): VanillaStats {
  const stats = isObj(json) && isObj(json.stats) ? json.stats : {};
  const custom = isObj(stats['minecraft:custom']) ? stats['minecraft:custom'] : {};
  const ticks = num(custom['minecraft:play_time']) ?? num(custom['minecraft:play_one_minute']);
  const cm = Object.entries(custom).filter(([k]) => k.endsWith('_one_cm')).map(([, v]) => num(v)).filter((v): v is number => v !== null);
  const damage = num(custom['minecraft:damage_taken']);
  return {
    playTimeSeconds: ticks === null ? null : Math.round(ticks / 20),
    deaths: num(custom['minecraft:deaths']),
    playerKills: num(custom['minecraft:player_kills']),
    mobKills: num(custom['minecraft:mob_kills']),
    distanceMeters: cm.length ? Math.round(cm.reduce((a, b) => a + b, 0) / 100) : null,
    jumps: num(custom['minecraft:jump']),
    damageTaken: damage === null ? null : Math.round(damage / 10),
    blocksMined: sumValues(stats['minecraft:mined']),
    itemsCrafted: sumValues(stats['minecraft:crafted']),
  };
}

/** `<level-name>/stats/<uuid>.json`, null si absent ; l'UUID est validé avant de former le chemin. */
export async function readPlayerStats(dataDir: string, uuid: string): Promise<VanillaStats | null> {
  if (!isUuid(uuid)) return null;
  const props = await readServerProperties(dataDir).catch(() => ({} as Record<string, string>));
  const level = props['level-name'] || 'world';
  const file = path.join(dataDir, level, 'stats', `${uuid.toLowerCase()}.json`);
  try { return parseVanillaStats(JSON.parse(await readFile(file, 'utf8'))); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file }, 'cannot read player stats');
    return null;
  }
}
