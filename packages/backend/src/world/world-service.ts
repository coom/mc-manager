import { GAMERULES, GAMEMODES, type Gamemode, type WorldState } from '@mc/common';
import { lockedKeys } from '../server-properties/itzg-env.js';
import { isUnknownCommand, parseDifficulty, parseGamerule, parseTickStatus, parseTimeQuery } from './parsers.js';

export interface WorldDeps {
  rcon: { send(cmd: string): Promise<string> };
  docker: { inspectServer(): Promise<{ env: string[] } | null> };
  properties: { read(): Promise<{ values: Record<string, string> }> };
}

const NO_TICK = { targetRate: null, frozen: false, sprinting: false };

/**
 * Réglages du monde appliqués à chaud par RCON (heure, météo, tick, difficulté, mode de jeu, gamerules).
 * Rien n'est écrit dans /data : le serveur persiste lui-même ces valeurs dans le monde.
 */
export class WorldService {
  constructor(private deps: WorldDeps) {}

  /** État courant ; une réponse non reconnue donne null pour le champ concerné, jamais une erreur. */
  async read(): Promise<WorldState> {
    const send = (cmd: string) => this.deps.rcon.send(cmd);
    const daytime = parseTimeQuery(await send('time query daytime'));
    const day = parseTimeQuery(await send('time query day'));
    const tickRaw = await send('tick query');
    const tick = isUnknownCommand(tickRaw) ? { supported: false, ...NO_TICK } : { supported: true, ...(parseTickStatus(tickRaw) ?? NO_TICK) };
    const difficulty = parseDifficulty(await send('difficulty'));
    const gamerules: Record<string, boolean | number | null> = {};
    for (const g of GAMERULES) gamerules[g.name] = parseGamerule(await send(`gamerule ${g.name}`));
    const props = await this.deps.properties.read().catch(() => null);
    const gm = props?.values.gamemode?.toLowerCase();
    const defaultGamemode = gm && (GAMEMODES as readonly string[]).includes(gm) ? (gm as Gamemode) : null;
    const inspect = await this.deps.docker.inspectServer().catch(() => null);
    const locked = lockedKeys(inspect?.env ?? []);
    const resetOnRestart: WorldState['resetOnRestart'] = {};
    if (locked.difficulty && locked.difficulty !== 'rcon') resetOnRestart.difficulty = locked.difficulty;
    if (locked.gamemode && locked.gamemode !== 'rcon') resetOnRestart.gamemode = locked.gamemode;
    return { time: { daytime, day }, tick, difficulty, defaultGamemode, gamerules, resetOnRestart };
  }
}
