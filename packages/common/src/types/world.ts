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
/**
 * `name` est l'identifiant du registre (snake_case, Minecraft 1.21.11+, snapshot 25w44a) ; `legacy` l'ancien nom
 * camelCase accepté jusqu'en 1.21.10. `invertedLegacy` : l'ancienne règle avait le sens contraire (disableRaids → raids).
 */
export interface GameruleDef { name: string; legacy?: string; invertedLegacy?: boolean; type: 'bool' | 'int'; group: GameruleGroup; min?: number; max?: number }
/** Gamerules exposées par la page Monde ; seule liste acceptée par le backend. */
export const GAMERULES: readonly GameruleDef[] = [
  { name: 'advance_time', legacy: 'doDaylightCycle', type: 'bool', group: 'world' },
  { name: 'advance_weather', legacy: 'doWeatherCycle', type: 'bool', group: 'world' },
  { name: 'random_tick_speed', legacy: 'randomTickSpeed', type: 'int', group: 'world', min: 0, max: 4096 },
  { name: 'mob_griefing', legacy: 'mobGriefing', type: 'bool', group: 'world' },
  { name: 'block_drops', legacy: 'doTileDrops', type: 'bool', group: 'world' },
  { name: 'entity_drops', legacy: 'doEntityDrops', type: 'bool', group: 'world' },
  { name: 'mob_drops', legacy: 'doMobLoot', type: 'bool', group: 'world' },
  { name: 'keep_inventory', legacy: 'keepInventory', type: 'bool', group: 'players' },
  { name: 'natural_health_regeneration', legacy: 'naturalRegeneration', type: 'bool', group: 'players' },
  { name: 'immediate_respawn', legacy: 'doImmediateRespawn', type: 'bool', group: 'players' },
  { name: 'players_sleeping_percentage', legacy: 'playersSleepingPercentage', type: 'int', group: 'players', min: 0, max: 100 },
  { name: 'respawn_radius', legacy: 'spawnRadius', type: 'int', group: 'players', min: 0, max: 128 },
  { name: 'fall_damage', legacy: 'fallDamage', type: 'bool', group: 'players' },
  { name: 'drowning_damage', legacy: 'drowningDamage', type: 'bool', group: 'players' },
  { name: 'fire_damage', legacy: 'fireDamage', type: 'bool', group: 'players' },
  { name: 'freeze_damage', legacy: 'freezeDamage', type: 'bool', group: 'players' },
  { name: 'spawn_mobs', legacy: 'doMobSpawning', type: 'bool', group: 'spawning' },
  { name: 'spawn_phantoms', legacy: 'doInsomnia', type: 'bool', group: 'spawning' },
  { name: 'spawn_patrols', legacy: 'doPatrolSpawning', type: 'bool', group: 'spawning' },
  { name: 'spawn_wandering_traders', legacy: 'doTraderSpawning', type: 'bool', group: 'spawning' },
  { name: 'spawn_wardens', legacy: 'doWardenSpawning', type: 'bool', group: 'spawning' },
  { name: 'raids', legacy: 'disableRaids', invertedLegacy: true, type: 'bool', group: 'spawning' },
  { name: 'max_entity_cramming', legacy: 'maxEntityCramming', type: 'int', group: 'spawning', min: 0, max: 100 },
  { name: 'show_advancement_messages', legacy: 'announceAdvancements', type: 'bool', group: 'misc' },
  { name: 'show_death_messages', legacy: 'showDeathMessages', type: 'bool', group: 'misc' },
  { name: 'command_block_output', legacy: 'commandBlockOutput', type: 'bool', group: 'misc' },
  { name: 'send_command_feedback', legacy: 'sendCommandFeedback', type: 'bool', group: 'misc' },
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
  /** Une clé par entrée de GAMERULES (identifiant moderne) ; null si réponse non reconnue. */
  gamerules: Record<string, boolean | number | null>;
  /** true si le serveur n'accepte que les anciens noms camelCase (≤ 1.21.10). */
  legacyGamerules: boolean;
  /** Variable itzg qui réécrira la clé au redémarrage (absente si le fichier est maître). */
  resetOnRestart: { difficulty?: string; gamemode?: string };
}
export type WorldTickUpdate = { rate: number } | { frozen: boolean } | { sprint: number };
