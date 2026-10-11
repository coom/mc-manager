import type { ModsDir, ModsSource } from '@mc/common';

/** Chemin du fichier de liste tel que le conteneur Minecraft le voit (son volume est monté sur /data). */
export const LISTING_PATH_IN_CONTAINER = '/data/mc-manager/modrinth-projects.txt';
/** Même fichier, relatif à dataDir côté backend. */
export const LISTING_RELATIVE = 'mc-manager/modrinth-projects.txt';
export const COMPOSE_LINE = `MODRINTH_PROJECTS: "@${LISTING_PATH_IN_CONTAINER}"`;

const MOD_LOADERS: Record<string, string> = { FABRIC: 'fabric', QUILT: 'quilt', FORGE: 'forge', NEOFORGE: 'neoforge' };
const PLUGIN_LOADERS: Record<string, string> = { PAPER: 'paper', SPIGOT: 'spigot', BUKKIT: 'bukkit', PURPUR: 'purpur', FOLIA: 'folia' };

export function envMap(env: string[]): Map<string, string> {
  const vars = new Map<string, string>();
  for (const e of env) { const i = e.indexOf('='); if (i > 0) vars.set(e.slice(0, i), e.slice(i + 1)); }
  return vars;
}

/** Loader Modrinth et dossier cible d'après TYPE ; null si vanilla ou type inconnu. */
export function serverTypeOf(env: string[]): { loader: string; dir: ModsDir } | null {
  const type = (envMap(env).get('TYPE') ?? 'VANILLA').trim().toUpperCase();
  if (MOD_LOADERS[type]) return { loader: MOD_LOADERS[type], dir: 'mods' };
  if (PLUGIN_LOADERS[type]) return { loader: PLUGIN_LOADERS[type], dir: 'plugins' };
  return null;
}

/** Origine de la liste Modrinth d'après MODRINTH_PROJECTS du conteneur. */
export function modrinthSource(env: string[]): { source: ModsSource; inlineEntries: string[] } {
  const value = (envMap(env).get('MODRINTH_PROJECTS') ?? '').trim();
  if (!value) return { source: 'none', inlineEntries: [] };
  if (value === `@${LISTING_PATH_IN_CONTAINER}`) return { source: 'file', inlineEntries: [] };
  if (value.startsWith('@')) return { source: 'other', inlineEntries: [] };
  const inlineEntries = value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return { source: 'inline', inlineEntries };
}
