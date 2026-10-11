import { readFile, stat } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Écrit par mc-image-helper dans /data à chaque démarrage : `files` relatifs à /data, `projects` = valeur
 * brute de --projects (donc `@/data/…` quand MODRINTH_PROJECTS pointe sur un fichier de liste, jamais
 * les entrées développées), `timestamp` = instant de l'écriture.
 */
export const MANIFEST_FILE = '.modrinth-manifest.json';
export interface ModrinthManifest { files: string[]; projects: string[]; timestamp: Date }

const normalizeRel = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

/** Jackson sérialise un Instant en secondes epoch (décimales) ou en ISO 8601 selon la configuration. */
function parseTimestamp(x: unknown): Date | null {
  if (typeof x === 'number' && Number.isFinite(x)) return new Date(Math.round(x * 1000));
  if (typeof x === 'string') { const t = Date.parse(x); if (!Number.isNaN(t)) return new Date(t); }
  return null;
}

/** Absent, illisible ou invalide → null (journalisé en warn sauf ENOENT). */
export async function readManifest(dataDir: string): Promise<ModrinthManifest | null> {
  const file = path.join(dataDir, MANIFEST_FILE);
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file }, 'cannot read modrinth manifest'); return null; }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { logger.warn({ file }, 'modrinth manifest is not an object'); return null; }
    const m = parsed as Record<string, unknown>;
    const timestamp = parseTimestamp(m.timestamp) ?? (await stat(file)).mtime;
    return { files: strings(m.files).map(normalizeRel), projects: strings(m.projects), timestamp };
  } catch (err) { logger.warn({ err, file }, 'modrinth manifest is not valid JSON'); return null; }
}
