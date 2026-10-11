import { describe, it, expect } from 'vitest';
import { GAMERULES } from '@mc/common';
import { WorldService } from './world-service.js';
import { AppError } from '../middleware/error-handler.js';

/** Faux RCON : réponses par commande exacte, « Unknown or incomplete command » sinon ; garde la trace des envois. */
export function fakeRcon(replies: Record<string, string> = {}) {
  const sent: string[] = [];
  return {
    sent,
    replies,
    send: async (cmd: string) => { sent.push(cmd); return replies[cmd] ?? 'Unknown or incomplete command, see below for error'; },
  };
}
/** Serveur 1.21.11+ : timelines et « Game rule … set to X » ; `time query daytime` n'existe plus. */
const vanillaReplies = () => ({
  'time query day': 'Timeline minecraft:day is at 6000 tick(s)',
  'time query day repetitions': 'Timeline minecraft:day has passed 12 repetition(s)',
  'time query daytime': "Can't find element 'minecraft:daytime' of type 'minecraft:timeline'",
  'tick query': 'Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)',
  difficulty: 'The difficulty is Normal',
  ...Object.fromEntries(GAMERULES.map((g) => [`gamerule ${g.name}`, `Game rule ${g.name} is currently set to ${g.type === 'bool' ? 'true' : '3'}`])),
});
/** Serveur ≤ 1.21.10 : seuls les anciens noms camelCase répondent, les identifiants modernes sont rejetés. */
const legacyReplies = () => ({
  'time query daytime': 'The time is 6000', 'time query day': 'The time is 12',
  'tick query': 'Target tick rate: 20.0 per second.', difficulty: 'The difficulty is Normal',
  ...Object.fromEntries(GAMERULES.map((g) => [`gamerule ${g.legacy}`, `Gamerule ${g.legacy} is currently set to: ${g.type === 'bool' ? 'true' : '3'}`])),
  ...Object.fromEntries(GAMERULES.map((g) => [`gamerule ${g.name}`, `Incorrect argument for command
gamerule ${g.name}<--[HERE]`])),
});
const deps = (rcon: ReturnType<typeof fakeRcon>, opts: { env?: string[]; gamemode?: string } = {}) => ({
  rcon,
  docker: { inspectServer: async () => ({ env: opts.env ?? [] }) },
  properties: { read: async () => ({ values: opts.gamemode === undefined ? {} : { gamemode: opts.gamemode } }) },
});

describe('WorldService.read', () => {
  it('reads time, tick, difficulty, every catalogue gamerule and the default gamemode from server.properties', async () => {
    const rcon = fakeRcon(vanillaReplies());
    const state = await new WorldService(deps(rcon, { gamemode: 'Survival' })).read();
    expect(state.time).toEqual({ daytime: 6000, day: 12 });
    expect(state.tick).toEqual({ supported: true, targetRate: 20, frozen: false, sprinting: false });
    expect(state.difficulty).toBe('normal');
    expect(state.defaultGamemode).toBe('survival');
    expect(Object.keys(state.gamerules).sort()).toEqual(GAMERULES.map((g) => g.name).sort());
    expect(state.gamerules.keep_inventory).toBe(true);
    expect(state.gamerules.random_tick_speed).toBe(3);
    expect(state.legacyGamerules).toBe(false);
    expect(state.resetOnRestart).toEqual({});
    expect(rcon.sent[0]).toBe('time query day');
    expect(rcon.sent).not.toContain('time query daytime');
    expect(rcon.sent).toContain('gamerule keep_inventory');
  });
  it('leaves the day count unknown when the repetitions query is refused', async () => {
    const replies = vanillaReplies(); delete (replies as Record<string, string>)['time query day repetitions'];
    const state = await new WorldService(deps(fakeRcon(replies))).read();
    expect(state.time).toEqual({ daytime: 6000, day: null });
  });
  it('marks tick as unsupported before 1.20.3 and keeps the rest of the state', async () => {
    const replies = vanillaReplies(); delete (replies as Record<string, string>)['tick query'];
    const state = await new WorldService(deps(fakeRcon(replies))).read();
    expect(state.tick).toEqual({ supported: false, targetRate: null, frozen: false, sprinting: false });
    expect(state.difficulty).toBe('normal');
  });
  it('reports frozen and sprinting states', async () => {
    const replies = { ...vanillaReplies(), 'tick query': 'The game is frozen\nTarget tick rate: 20.0 per second.' };
    expect((await new WorldService(deps(fakeRcon(replies))).read()).tick).toEqual({ supported: true, targetRate: 20, frozen: true, sprinting: false });
  });
  it('turns unrecognised replies into null without failing', async () => {
    const replies = { ...vanillaReplies(), 'time query day': 'weird', difficulty: 'The difficulty is Brutal', 'gamerule keep_inventory': 'nope' };
    const state = await new WorldService(deps(fakeRcon(replies), { gamemode: 'hardcore' })).read();
    expect(state.time.daytime).toBeNull();
    expect(state.difficulty).toBeNull();
    expect(state.gamerules.keep_inventory).toBeNull();
    expect(state.gamerules.mob_griefing).toBe(true);
    expect(state.defaultGamemode).toBeNull();
  });
  it('reports the itzg variables that will reset difficulty and gamemode at restart', async () => {
    const env = ['DIFFICULTY=hard', 'MODE=creative', 'MOTD=hi'];
    expect((await new WorldService(deps(fakeRcon(vanillaReplies()), { env })).read()).resetOnRestart).toEqual({ difficulty: 'DIFFICULTY', gamemode: 'MODE' });
    expect((await new WorldService(deps(fakeRcon(vanillaReplies()), { env: [...env, 'OVERRIDE_SERVER_PROPERTIES=false'] })).read()).resetOnRestart).toEqual({});
  });
  it('falls back to the legacy camelCase names on an old server and inverts raids', async () => {
    const rcon = fakeRcon(legacyReplies());
    const state = await new WorldService(deps(rcon)).read();
    expect(state.legacyGamerules).toBe(true);
    expect(state.time).toEqual({ daytime: 6000, day: 12 });
    expect(rcon.sent).toContain('time query daytime');
    expect(rcon.sent).not.toContain('time query day repetitions');
    expect(state.gamerules.keep_inventory).toBe(true);
    expect(state.gamerules.random_tick_speed).toBe(3);
    // disableRaids=true ⇔ raids=false
    expect(state.gamerules.raids).toBe(false);
    expect(rcon.sent).toContain('gamerule doDaylightCycle');
    expect(rcon.sent).not.toContain('gamerule keep_inventory');
    expect(rcon.sent.filter((c) => c.startsWith('gamerule ')).length).toBe(GAMERULES.length + 1);
  });
  it('tolerates docker and properties failures', async () => {
    const svc = new WorldService({ rcon: fakeRcon(vanillaReplies()), docker: { inspectServer: async () => { throw new Error('no socket'); } }, properties: { read: async () => { throw new Error('ENOENT'); } } });
    const state = await svc.read();
    expect(state.resetOnRestart).toEqual({});
    expect(state.defaultGamemode).toBeNull();
  });
  it('propagates an RCON outage', async () => {
    const rcon = { send: async () => { throw new AppError(503, 'RCON not connected'); } };
    await expect(new WorldService(deps(rcon as never)).read()).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('WorldService setters', () => {
  const svc = (rcon: ReturnType<typeof fakeRcon>) => new WorldService(deps(rcon));
  it('sends one exact command per action', async () => {
    const rcon = fakeRcon({
      'time set night': 'Set the time to 13000', 'weather thunder': 'Set the weather to thunder', 'difficulty hard': 'The difficulty has been set to Hard',
      'defaultgamemode creative': 'The default game mode is now Creative Mode', 'tick rate 40': 'Set the target tick rate to 40.0 per second',
      'tick freeze': 'The game is now frozen', 'tick unfreeze': 'The game is now running', 'tick sprint 1200': 'Sprinting 1200 ticks',
      'gamerule keep_inventory true': 'Gamerule keep_inventory is now set to: true', 'gamerule random_tick_speed 100': 'Gamerule random_tick_speed is now set to: 100',
    });
    const s = svc(rcon);
    await s.setTime('night'); await s.setWeather('thunder'); await s.setDifficulty('hard'); await s.setDefaultGamemode('creative');
    await s.setTick({ rate: 40 }); await s.setTick({ frozen: true }); await s.setTick({ frozen: false }); await s.setTick({ sprint: 1200 });
    await s.setGamerule('keep_inventory', true); await s.setGamerule('random_tick_speed', 100);
    expect(rcon.sent).toEqual(['time set night', 'weather thunder', 'difficulty hard', 'defaultgamemode creative', 'tick rate 40', 'tick freeze', 'tick unfreeze', 'tick sprint 1200', 'gamerule keep_inventory true', 'gamerule random_tick_speed 100']);
  });
  it('treats an empty reply and a "did not change" reply as success', async () => {
    const rcon = fakeRcon({ 'difficulty normal': 'The difficulty did not change; it is already set to Normal', 'gamerule keep_inventory false': '' });
    await expect(svc(rcon).setDifficulty('normal')).resolves.toBeUndefined();
    await expect(svc(rcon).setGamerule('keep_inventory', false)).resolves.toBeUndefined();
  });
  it('maps an unknown command to 501 with the unsupported code', async () => {
    await expect(svc(fakeRcon()).setTick({ rate: 40 })).rejects.toMatchObject({ statusCode: 501, code: 'unsupported' });
  });
  it('maps a missing registry element to 502', async () => {
    const rcon = fakeRcon({ 'time set day': "Can't find element 'minecraft:day' of type 'minecraft:time_marker'" });
    await expect(svc(rcon).setTime('day')).rejects.toMatchObject({ statusCode: 502 });
  });
  it('maps an argument error to 502', async () => {
    const rcon = fakeRcon({ 'gamerule random_tick_speed 100': 'Incorrect argument for command' });
    await expect(svc(rcon).setGamerule('random_tick_speed', 100)).rejects.toMatchObject({ statusCode: 502 });
  });
  it('uses the legacy names (and inverts raids) after reading a legacy server', async () => {
    const rcon = fakeRcon({ ...legacyReplies(), 'gamerule keepInventory true': 'Gamerule keepInventory is now set to: true', 'gamerule disableRaids true': 'Gamerule disableRaids is now set to: true' });
    const s = svc(rcon);
    await s.read();
    const before = rcon.sent.length;
    await s.setGamerule('keep_inventory', true);
    await s.setGamerule('raids', false);
    expect(rcon.sent.slice(before)).toEqual(['gamerule keepInventory true', 'gamerule disableRaids true']);
  });
  it('validates before sending anything', async () => {
    const rcon = fakeRcon();
    await expect(svc(rcon).setGamerule('random_tick_speed', '5' as never)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc(rcon).setTick({ rate: 0 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc(rcon).setTime('dawn' as never)).rejects.toMatchObject({ statusCode: 400 });
    expect(rcon.sent).toEqual([]);
  });
});
