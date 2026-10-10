import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { readJsonArray, readLists, readUserCache, parseVanillaStats, readPlayerStats, isUuid } from './data-files.js';

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';

describe('data files', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'mc-data-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns an empty array for a missing file', async () => {
    expect(await readJsonArray(dir, 'whitelist.json')).toEqual([]);
  });
  it('returns an empty array for invalid JSON or a non-array', async () => {
    writeFileSync(path.join(dir, 'banned-players.json'), '{ not json');
    writeFileSync(path.join(dir, 'ops.json'), '{"a":1}');
    expect(await readJsonArray(dir, 'banned-players.json')).toEqual([]);
    expect(await readJsonArray(dir, 'ops.json')).toEqual([]);
  });
  it('reads the four lists and the whitelist flag', async () => {
    writeFileSync(path.join(dir, 'whitelist.json'), JSON.stringify([{ uuid: UUID, name: 'Alice' }]));
    writeFileSync(path.join(dir, 'ops.json'), JSON.stringify([{ uuid: UUID, name: 'Alice', level: 4, bypassesPlayerLimit: false }]));
    writeFileSync(path.join(dir, 'banned-players.json'), JSON.stringify([{ uuid: 'x', name: 'Mallory', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: 'griefing' }]));
    writeFileSync(path.join(dir, 'banned-ips.json'), JSON.stringify([{ ip: '198.51.100.7', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: 'spam' }]));
    writeFileSync(path.join(dir, 'server.properties'), 'white-list=true\n');
    const lists = await readLists(dir);
    expect(lists.whitelist).toEqual([{ uuid: UUID, name: 'Alice' }]);
    expect(lists.ops[0]).toMatchObject({ name: 'Alice', level: 4 });
    expect(lists.bannedPlayers[0]).toMatchObject({ name: 'Mallory', reason: 'griefing' });
    expect(lists.bannedIps[0]).toMatchObject({ ip: '198.51.100.7' });
    expect(lists.whitelistEnabled).toBe(true);
  });
  it('whitelistEnabled is false without server.properties', async () => {
    expect((await readLists(dir)).whitelistEnabled).toBe(false);
  });
  it('drops malformed entries instead of failing', async () => {
    writeFileSync(path.join(dir, 'whitelist.json'), JSON.stringify([{ uuid: UUID, name: 'Alice' }, { name: 'NoUuid' }, 'junk', null]));
    expect((await readLists(dir)).whitelist).toEqual([{ uuid: UUID, name: 'Alice' }]);
  });
  it('reads the user cache', async () => {
    writeFileSync(path.join(dir, 'usercache.json'), JSON.stringify([{ name: 'Alice', uuid: UUID, expiresOn: '2026-11-10 10:00:00 +0000' }]));
    expect(await readUserCache(dir)).toEqual([{ name: 'Alice', uuid: UUID }]);
  });
  it('reads a stats file from the level directory', async () => {
    mkdirSync(path.join(dir, 'world', 'stats'), { recursive: true });
    writeFileSync(path.join(dir, 'server.properties'), 'level-name=world\n');
    writeFileSync(path.join(dir, 'world', 'stats', `${UUID}.json`), JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:play_time': 72000, 'minecraft:deaths': 3 } }, DataVersion: 3953 }));
    expect(await readPlayerStats(dir, UUID)).toMatchObject({ playTimeSeconds: 3600, deaths: 3, mobKills: null });
    expect(await readPlayerStats(dir, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
  it('rejects a non-UUID before touching the filesystem', async () => {
    expect(isUuid('../../etc/passwd')).toBe(false);
    expect(await readPlayerStats(dir, '../server.properties')).toBeNull();
  });
});

describe('parseVanillaStats', () => {
  it('maps modern keys and sums mined/crafted', () => {
    const s = parseVanillaStats({ stats: {
      'minecraft:custom': { 'minecraft:play_time': 1200, 'minecraft:deaths': 2, 'minecraft:player_kills': 1, 'minecraft:mob_kills': 40, 'minecraft:walk_one_cm': 150000, 'minecraft:sprint_one_cm': 50000, 'minecraft:jump': 99, 'minecraft:damage_taken': 250 },
      'minecraft:mined': { 'minecraft:stone': 10, 'minecraft:dirt': 5 },
      'minecraft:crafted': { 'minecraft:stick': 4 },
    } });
    expect(s).toEqual({ playTimeSeconds: 60, deaths: 2, playerKills: 1, mobKills: 40, distanceMeters: 2000, jumps: 99, damageTaken: 25, blocksMined: 15, itemsCrafted: 4 });
  });
  it('falls back to play_one_minute and leaves missing keys null', () => {
    const s = parseVanillaStats({ stats: { 'minecraft:custom': { 'minecraft:play_one_minute': 2400 } } });
    expect(s.playTimeSeconds).toBe(120);
    expect(s.deaths).toBeNull();
    expect(s.distanceMeters).toBeNull();
    expect(s.blocksMined).toBeNull();
  });
  it('tolerates garbage', () => {
    expect(parseVanillaStats(null).playTimeSeconds).toBeNull();
    expect(parseVanillaStats({ stats: 'x' }).deaths).toBeNull();
  });
});
