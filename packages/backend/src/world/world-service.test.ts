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
const vanillaReplies = () => ({
  'time query daytime': 'The time is 6000',
  'time query day': 'The time is 12',
  'tick query': 'Target tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)',
  difficulty: 'The difficulty is Normal',
  ...Object.fromEntries(GAMERULES.map((g) => [`gamerule ${g.name}`, `Gamerule ${g.name} is currently set to: ${g.type === 'bool' ? 'true' : '3'}`])),
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
    expect(state.gamerules.keepInventory).toBe(true);
    expect(state.gamerules.randomTickSpeed).toBe(3);
    expect(state.resetOnRestart).toEqual({});
    expect(rcon.sent[0]).toBe('time query daytime');
    expect(rcon.sent).toContain('gamerule keepInventory');
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
    const replies = { ...vanillaReplies(), 'time query daytime': 'weird', difficulty: 'The difficulty is Brutal', 'gamerule keepInventory': 'nope' };
    const state = await new WorldService(deps(fakeRcon(replies), { gamemode: 'hardcore' })).read();
    expect(state.time.daytime).toBeNull();
    expect(state.difficulty).toBeNull();
    expect(state.gamerules.keepInventory).toBeNull();
    expect(state.gamerules.mobGriefing).toBe(true);
    expect(state.defaultGamemode).toBeNull();
  });
  it('reports the itzg variables that will reset difficulty and gamemode at restart', async () => {
    const env = ['DIFFICULTY=hard', 'MODE=creative', 'MOTD=hi'];
    expect((await new WorldService(deps(fakeRcon(vanillaReplies()), { env })).read()).resetOnRestart).toEqual({ difficulty: 'DIFFICULTY', gamemode: 'MODE' });
    expect((await new WorldService(deps(fakeRcon(vanillaReplies()), { env: [...env, 'OVERRIDE_SERVER_PROPERTIES=false'] })).read()).resetOnRestart).toEqual({});
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
