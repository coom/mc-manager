import registry from './registry.json';

// Complétion de la console : commandes vanilla, joueurs en ligne et identifiants du registre
// (generé par scripts/gen-mc-registry.mjs). RCON n'offre pas de complétion : tout est local.

type Kind = 'player' | 'item' | 'block' | 'entity' | 'effect' | 'enchantment' | 'coord' | 'none';
/** Une position : un type, une liste de littéraux, ou un embranchement (littéral -> suite de la grammaire). */
type Arg = Kind | string[] | Record<string, Arg[]>;

const SELECTORS = ['@a', '@e', '@p', '@r', '@s'];
const MODES = ['adventure', 'creative', 'spectator', 'survival'];
const COORDS: Arg[] = ['coord', 'coord', 'coord'];
const XP_UNITS = ['levels', 'points'];

/**
 * Commandes vanilla Java : liste de positions, ou directement un embranchement sur le premier mot.
 * Une commande sans position décrite propose les joueurs en ligne pour tous ses arguments.
 */
const GRAMMAR: Record<string, Arg[] | Record<string, Arg[]>> = {
  advancement: { grant: ['player', ['everything', 'from', 'only', 'through', 'until']], revoke: ['player', ['everything', 'from', 'only', 'through', 'until']] },
  attribute: ['player'],
  ban: ['player'],
  'ban-ip': ['player'],
  banlist: [['ips', 'players']],
  bossbar: { add: [], get: [], list: [], remove: [], set: [] },
  clear: ['player', 'item'],
  clone: [...COORDS, ...COORDS, ...COORDS],
  damage: ['player'],
  data: { get: [], merge: [], modify: [], remove: [] },
  datapack: { disable: [], enable: [], list: [] },
  debug: [['function', 'start', 'stop']],
  defaultgamemode: [MODES],
  deop: ['player'],
  difficulty: [['easy', 'hard', 'normal', 'peaceful']],
  effect: { clear: ['player', 'effect'], give: ['player', 'effect'] },
  enchant: ['player', 'enchantment'],
  execute: [],
  experience: { add: ['player', 'none', XP_UNITS], query: ['player', XP_UNITS], set: ['player', 'none', XP_UNITS] },
  fill: [...COORDS, ...COORDS, 'block'],
  fillbiome: [...COORDS, ...COORDS],
  forceload: { add: [], query: [], remove: [] },
  function: [],
  gamemode: [MODES, 'player'],
  gamerule: [],
  give: ['player', 'item'],
  help: [],
  item: { modify: [], replace: [] },
  jfr: [['start', 'stop']],
  kick: ['player'],
  kill: ['player'],
  list: [['uuids']],
  locate: { biome: [], poi: [], structure: [] },
  loot: [],
  me: [],
  msg: ['player'],
  op: ['player'],
  pardon: ['player'],
  'pardon-ip': ['player'],
  particle: [],
  perf: [['start', 'stop']],
  place: { feature: [], jigsaw: [], structure: [], template: [] },
  playsound: [],
  random: [],
  recipe: { give: ['player'], take: ['player'] },
  reload: [],
  return: [],
  ride: ['player'],
  rotate: ['player'],
  'save-all': [['flush']],
  'save-off': [],
  'save-on': [],
  say: [],
  schedule: [],
  scoreboard: { objectives: [['add', 'list', 'modify', 'remove', 'setdisplay']], players: [['add', 'enable', 'get', 'list', 'operation', 'remove', 'reset', 'set']] },
  seed: [],
  setblock: [...COORDS, 'block'],
  setidletimeout: [],
  setworldspawn: [...COORDS],
  spawnpoint: ['player', ...COORDS],
  spectate: ['player', 'player'],
  spreadplayers: [],
  stop: [],
  stopsound: ['player'],
  summon: ['entity', ...COORDS],
  team: { add: [], empty: [], join: ['none', 'player'], leave: ['player'], list: [], modify: [], remove: [] },
  teammsg: [],
  teleport: ['player', 'player'],
  tell: ['player'],
  tellraw: ['player'],
  tick: { freeze: [], query: [], rate: [], sprint: [], step: [], unfreeze: [] },
  time: { add: [], query: [['day', 'daytime', 'gametime']], set: [['day', 'midnight', 'night', 'noon']] },
  title: ['player', ['actionbar', 'clear', 'reset', 'subtitle', 'times', 'title']],
  tm: [],
  tp: ['player', 'player'],
  transfer: [],
  trigger: [],
  w: ['player'],
  weather: [['clear', 'rain', 'thunder']],
  whitelist: { add: ['player'], list: [], off: [], on: [], reload: [], remove: ['player'] },
  worldborder: { add: [], center: [], damage: [], get: [], set: [], warning: [] },
  xp: { add: ['player', 'none', XP_UNITS], query: ['player', XP_UNITS], set: ['player', 'none', XP_UNITS] },
};

export const COMMAND_NAMES = Object.keys(GRAMMAR).sort();

const NAMESPACE = 'minecraft:';
const REGISTRY: Record<Exclude<Kind, 'player' | 'coord' | 'none'>, string[]> = {
  item: registry.items, block: registry.blocks, entity: registry.entities, effect: registry.effects, enchantment: registry.enchantments,
};

export interface Completion {
  /** Mot en cours d'édition (après le dernier espace). */
  word: string;
  /** Position du mot dans la saisie. */
  start: number;
  candidates: string[];
}

function filter(pool: string[], word: string): string[] {
  const prefix = word.toLowerCase();
  return pool.filter((c) => c.toLowerCase().startsWith(prefix));
}

function candidatesFor(arg: Arg | undefined, word: string, players: string[]): string[] {
  if (arg === undefined || arg === 'player') return filter([...SELECTORS, ...players], word);
  if (Array.isArray(arg)) return filter(arg, word);
  if (typeof arg === 'object') return filter(Object.keys(arg), word);
  if (arg === 'none') return [];
  if (arg === 'coord') return word === '' ? ['~'] : [];
  const namespaced = word.toLowerCase().startsWith(NAMESPACE);
  const matches = filter(REGISTRY[arg], namespaced ? word.slice(NAMESPACE.length) : word);
  return namespaced ? matches.map((m) => NAMESPACE + m) : matches;
}

/** Descend la grammaire le long des mots déjà saisis et renvoie la position attendue pour le mot courant. */
function resolve(args: Arg[], typed: string[]): Arg | undefined {
  let rest = args;
  for (const t of typed) {
    const spec: Arg | undefined = rest[0];
    if (spec !== undefined && typeof spec === 'object' && !Array.isArray(spec)) {
      const key = Object.keys(spec).find((k) => k.toLowerCase() === t.toLowerCase());
      if (!key) return undefined;
      rest = spec[key];
    } else {
      rest = rest.slice(1);
    }
  }
  return rest[0];
}

export function complete(input: string, players: string[]): Completion {
  const text = input.startsWith('/') ? input.slice(1) : input;
  const offset = input.length - text.length;
  const lastSpace = text.lastIndexOf(' ');
  const word = text.slice(lastSpace + 1);
  const start = offset + lastSpace + 1;
  if (lastSpace === -1) return { word, start, candidates: filter(COMMAND_NAMES, word) };
  const [name, ...typed] = text.slice(0, lastSpace).split(/\s+/).filter(Boolean);
  const grammar = GRAMMAR[name.toLowerCase()];
  const args = grammar === undefined || Array.isArray(grammar) ? grammar : [grammar];
  // Position non décrite (ou commande sans grammaire) : les joueurs en ligne, le comportement par défaut.
  const arg = args && args.length > 0 ? resolve(args, typed) : undefined;
  return { word, start, candidates: candidatesFor(arg, word, players) };
}

/** Remplace le mot courant par le candidat choisi et ajoute l'espace suivant. */
export function applyCompletion(input: string, completion: Completion, index: number): string {
  const choice = completion.candidates[index];
  if (choice === undefined) return input;
  return input.slice(0, completion.start) + choice + ' ';
}
