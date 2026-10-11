import { GAMERULES, GAMEMODES, type Difficulty, type Gamemode, type GameruleDef, type TimePreset, type WeatherKind, type WorldState, type WorldTickUpdate } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';
import { stripColors } from '../rcon/parsers.js';
import { lockedKeys } from '../server-properties/itzg-env.js';
import { isUnknownCommand, parseDifficulty, parseGamerule, parseTickStatus, parseTimeQuery, parseTimelinePosition, parseTimelineRepetitions } from './parsers.js';
import { assertDifficulty, assertGamemode, assertGamerule, assertPreset, assertTick, assertWeather } from './validate.js';

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
  /** true quand le serveur n'accepte que les anciens noms camelCase (≤ 1.21.10) ; détecté à chaque read(). */
  private legacyGamerules = false;

  constructor(private deps: WorldDeps) {}

  /** Nom envoyé au serveur selon le mode détecté. */
  private ruleName(def: GameruleDef): string {
    return this.legacyGamerules && def.legacy ? def.legacy : def.name;
  }

  /** Valeur côté serveur ⇄ valeur du catalogue (règles dont l'ancien nom avait le sens inverse). */
  private ruleValue(def: GameruleDef, value: boolean | number | null): boolean | number | null {
    return this.legacyGamerules && def.invertedLegacy && typeof value === 'boolean' ? !value : value;
  }

  /** État courant ; une réponse non reconnue donne null pour le champ concerné, jamais une erreur. */
  async read(): Promise<WorldState> {
    const send = (cmd: string) => this.deps.rcon.send(cmd);
    // 1.21.11+ : `day` est une timeline dont la position est l'heure du jour et `daytime` n'existe plus ;
    // avant : `time query daytime` donne l'heure et `time query day` le nombre de jours.
    const dayRaw = await send('time query day');
    const position = parseTimelinePosition(dayRaw);
    let daytime: number | null; let day: number | null;
    if (position !== null) {
      daytime = position;
      day = parseTimelineRepetitions(await send('time query day repetitions'));
    } else {
      day = parseTimeQuery(dayRaw);
      daytime = parseTimeQuery(await send('time query daytime'));
    }
    const tickRaw = await send('tick query');
    const tick = isUnknownCommand(tickRaw) ? { supported: false, ...NO_TICK } : { supported: true, ...(parseTickStatus(tickRaw) ?? NO_TICK) };
    const difficulty = parseDifficulty(await send('difficulty'));
    const gamerules: Record<string, boolean | number | null> = {};
    // Détection du nommage sur la première règle : identifiant moderne, puis ancien nom si le serveur le rejette.
    const [probe, ...rest] = GAMERULES;
    this.legacyGamerules = false;
    let probeValue = parseGamerule(await send(`gamerule ${probe.name}`));
    if (probeValue === null && probe.legacy) {
      const legacyValue = parseGamerule(await send(`gamerule ${probe.legacy}`));
      if (legacyValue !== null) { this.legacyGamerules = true; probeValue = legacyValue; }
    }
    gamerules[probe.name] = this.ruleValue(probe, probeValue);
    for (const g of rest) gamerules[g.name] = this.ruleValue(g, parseGamerule(await send(`gamerule ${this.ruleName(g)}`)));
    const props = await this.deps.properties.read().catch(() => null);
    const gm = props?.values.gamemode?.toLowerCase();
    const defaultGamemode = gm && (GAMEMODES as readonly string[]).includes(gm) ? (gm as Gamemode) : null;
    const inspect = await this.deps.docker.inspectServer().catch(() => null);
    const locked = lockedKeys(inspect?.env ?? []);
    const resetOnRestart: WorldState['resetOnRestart'] = {};
    if (locked.difficulty && locked.difficulty !== 'rcon') resetOnRestart.difficulty = locked.difficulty;
    if (locked.gamemode && locked.gamemode !== 'rcon') resetOnRestart.gamemode = locked.gamemode;
    return { time: { daytime, day }, tick, difficulty, defaultGamemode, gamerules, legacyGamerules: this.legacyGamerules, resetOnRestart };
  }

  /** Envoie une commande validée ; seuls les motifs d'erreur sont interprétés, la phrase de confirmation varie selon le serveur. */
  private async run(cmd: string): Promise<void> {
    const raw = stripColors(await this.deps.rcon.send(cmd));
    if (isUnknownCommand(raw)) throw new AppError(501, 'Command not supported by this server', undefined, 'unsupported');
    if (/incorrect argument|expected |invalid|unknown|can't find element/i.test(raw)) throw new AppError(502, `Unexpected server response: ${raw.slice(0, 200)}`);
  }

  async setTime(preset: TimePreset): Promise<void> { await this.run(`time set ${assertPreset(preset)}`); }
  async setWeather(kind: WeatherKind): Promise<void> { await this.run(`weather ${assertWeather(kind)}`); }
  async setDifficulty(d: Difficulty): Promise<void> { await this.run(`difficulty ${assertDifficulty(d)}`); }
  async setDefaultGamemode(g: Gamemode): Promise<void> { await this.run(`defaultgamemode ${assertGamemode(g)}`); }
  async setTick(update: WorldTickUpdate): Promise<void> {
    const u = assertTick(update);
    if ('rate' in u) await this.run(`tick rate ${u.rate}`);
    else if ('frozen' in u) await this.run(u.frozen ? 'tick freeze' : 'tick unfreeze');
    else await this.run(`tick sprint ${u.sprint}`);
  }
  async setGamerule(name: string, value: boolean | number): Promise<void> {
    const { def, value: v } = assertGamerule(name, value);
    await this.run(`gamerule ${this.ruleName(def)} ${this.ruleValue(def, v)}`);
  }
}
