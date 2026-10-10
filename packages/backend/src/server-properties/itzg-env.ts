/** Clés de server.properties réécrites par l'image itzg à chaque démarrage quand la variable est définie. */
export const ITZG_ENV: Record<string, string> = {
  motd: 'MOTD', difficulty: 'DIFFICULTY', 'max-players': 'MAX_PLAYERS', 'view-distance': 'VIEW_DISTANCE',
  'simulation-distance': 'SIMULATION_DISTANCE', 'white-list': 'ENABLE_WHITELIST', 'enforce-whitelist': 'ENFORCE_WHITELIST',
  'online-mode': 'ONLINE_MODE', pvp: 'PVP', gamemode: 'MODE', 'force-gamemode': 'FORCE_GAMEMODE', hardcore: 'HARDCORE',
  'level-name': 'LEVEL', 'level-seed': 'SEED', 'level-type': 'LEVEL_TYPE', 'spawn-protection': 'SPAWN_PROTECTION',
  'allow-flight': 'ALLOW_FLIGHT', 'allow-nether': 'ALLOW_NETHER', 'enable-command-block': 'ENABLE_COMMAND_BLOCK',
  'spawn-monsters': 'SPAWN_MONSTERS', 'spawn-animals': 'SPAWN_ANIMALS', 'spawn-npcs': 'SPAWN_NPCS',
  'generate-structures': 'GENERATE_STRUCTURES', 'max-world-size': 'MAX_WORLD_SIZE', 'max-tick-time': 'MAX_TICK_TIME',
  'server-port': 'SERVER_PORT', 'player-idle-timeout': 'PLAYER_IDLE_TIMEOUT', 'op-permission-level': 'OP_PERMISSION_LEVEL',
  'resource-pack': 'RESOURCE_PACK', 'resource-pack-sha1': 'RESOURCE_PACK_SHA1', 'enable-query': 'ENABLE_QUERY',
  'enable-status': 'ENABLE_STATUS', 'hide-online-players': 'HIDE_ONLINE_PLAYERS',
  'entity-broadcast-range-percentage': 'ENTITY_BROADCAST_RANGE_PERCENTAGE',
  'network-compression-threshold': 'NETWORK_COMPRESSION_THRESHOLD', 'sync-chunk-writes': 'SYNC_CHUNK_WRITES',
};

/** Toujours en lecture seule : les changer couperait MC Manager du serveur. */
export const ALWAYS_LOCKED = ['enable-rcon', 'rcon.port', 'rcon.password'] as const;

/** clé → variable qui la gouverne ('rcon' pour les clés RCON), d'après Config.Env du conteneur Minecraft. */
export function lockedKeys(env: string[]): Record<string, string> {
  const vars = new Map<string, string>();
  for (const e of env) { const i = e.indexOf('='); if (i > 0) vars.set(e.slice(0, i), e.slice(i + 1)); }
  const locked: Record<string, string> = {};
  const override = (vars.get('OVERRIDE_SERVER_PROPERTIES') ?? 'true').toLowerCase() !== 'false';
  if (override) for (const [key, v] of Object.entries(ITZG_ENV)) if (vars.get(v)) locked[key] = v;
  for (const k of ALWAYS_LOCKED) locked[k] = 'rcon';
  return locked;
}
