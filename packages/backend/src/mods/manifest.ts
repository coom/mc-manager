import { readFile } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

/** Écrit par mc-image-helper dans /data : `files` relatifs à /data, `projects` = entrées demandées. */
export const MANIFEST_FILE = '.modrinth-manifest.json';
export interface ModrinthManifest { files: string[]; projects: string[] }

const normalizeRel = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

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
    return { files: strings(m.files).map(normalizeRel), projects: strings(m.projects) };
  } catch (err) { logger.warn({ err, file }, 'modrinth manifest is not valid JSON'); return null; }
}
