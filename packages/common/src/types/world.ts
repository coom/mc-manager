export const TIME_PRESETS = ['day', 'noon', 'night', 'midnight'] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];
export const WEATHER_KINDS = ['clear', 'rain', 'thunder'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
export const DIFFICULTIES = ['peaceful', 'easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
export type Gamemode = (typeof GAMEMODES)[number];
/** `/tick rate` accepte 1.0 à 10000.0 ; 20 est la normale. */
export const TICK_RATE = { min: 1, max: 10000, default: 20 } as const;
/** `/tick sprint` : une heure de jeu au plus (72000 ticks). */
export const TICK_SPRINT_MAX = 72000;

export type GameruleGroup = 'world' | 'players' | 'spawning' | 'misc';
export interface GameruleDef { name: string; type: 'bool' | 'int'; group: GameruleGroup; min?: number; max?: number }
/** Gamerules exposées par la page Monde ; seule liste acceptée par le backend. */
export const GAMERULES: readonly GameruleDef[] = [
  { name: 'doDaylightCycle', type: 'bool', group: 'world' },
  { name: 'doWeatherCycle', type: 'bool', group: 'world' },
  { name: 'randomTickSpeed', type: 'int', group: 'world', min: 0, max: 4096 },
  { name: 'doFireTick', type: 'bool', group: 'world' },
  { name: 'mobGriefing', type: 'bool', group: 'world' },
  { name: 'doTileDrops', type: 'bool', group: 'world' },
  { name: 'doEntityDrops', type: 'bool', group: 'world' },
  { name: 'doMobLoot', type: 'bool', group: 'world' },
  { name: 'keepInventory', type: 'bool', group: 'players' },
  { name: 'naturalRegeneration', type: 'bool', group: 'players' },
  { name: 'doImmediateRespawn', type: 'bool', group: 'players' },
  { name: 'playersSleepingPercentage', type: 'int', group: 'players', min: 0, max: 100 },
  { name: 'spawnRadius', type: 'int', group: 'players', min: 0, max: 128 },
  { name: 'fallDamage', type: 'bool', group: 'players' },
  { name: 'drowningDamage', type: 'bool', group: 'players' },
  { name: 'fireDamage', type: 'bool', group: 'players' },
  { name: 'freezeDamage', type: 'bool', group: 'players' },
  { name: 'doMobSpawning', type: 'bool', group: 'spawning' },
  { name: 'doInsomnia', type: 'bool', group: 'spawning' },
  { name: 'doPatrolSpawning', type: 'bool', group: 'spawning' },
  { name: 'doTraderSpawning', type: 'bool', group: 'spawning' },
  { name: 'doWardenSpawning', type: 'bool', group: 'spawning' },
  { name: 'disableRaids', type: 'bool', group: 'spawning' },
  { name: 'maxEntityCramming', type: 'int', group: 'spawning', min: 0, max: 100 },
  { name: 'announceAdvancements', type: 'bool', group: 'misc' },
  { name: 'showDeathMessages', type: 'bool', group: 'misc' },
  { name: 'commandBlockOutput', type: 'bool', group: 'misc' },
  { name: 'sendCommandFeedback', type: 'bool', group: 'misc' },
];
export const GAMERULE_GROUPS: readonly GameruleGroup[] = ['world', 'players', 'spawning', 'misc'];

export interface WorldState {
  /** daytime 0..23999 (0 = 06:00 en jeu), day = nombre de jours écoulés ; null si réponse non reconnue. */
  time: { daytime: number | null; day: number | null };
  /** supported = false avant Minecraft 1.20.3 (`/tick` inconnu). */
  tick: { supported: boolean; targetRate: number | null; frozen: boolean; sprinting: boolean };
  difficulty: Difficulty | null;
  /** Lu dans server.properties (clé `gamemode`), que le serveur réécrit à chaque /defaultgamemode. */
  defaultGamemode: Gamemode | null;
  /** Une clé par entrée de GAMERULES ; null si réponse non reconnue. */
  gamerules: Record<string, boolean | number | null>;
  /** Variable itzg qui réécrira la clé au redémarrage (absente si le fichier est maître). */
  resetOnRestart: { difficulty?: string; gamemode?: string };
}
export type WorldTickUpdate = { rate: number } | { frozen: boolean } | { sprint: number };
