import { readFile } from 'fs/promises';
import { atomicWriteFile } from '../utils/atomic-write.js';

export const ENTRY_RE = /^((datapack|fabric|forge|paper):)?[A-Za-z0-9_-]{3,64}(:[A-Za-z0-9._+-]{1,64})?\??$/i;
const PREFIXES = new Set(['datapack', 'fabric', 'forge', 'paper']);

export const isValidEntry = (s: string): boolean => typeof s === 'string' && ENTRY_RE.test(s);

/** Préfixe de loader de l'entrée (`fabric:sodium` → 'fabric'), null sinon. */
export function prefixOf(entry: string): string | null {
  const parts = entry.replace(/\?$/, '').split(':');
  return parts.length >= 2 && PREFIXES.has(parts[0].toLowerCase()) ? parts[0].toLowerCase() : null;
}

/** Partie projet en minuscules : sans préfixe, sans version, sans `?`. */
export function slugOf(entry: string): string {
  const parts = entry.replace(/\?$/, '').split(':');
  if (parts.length >= 2 && PREFIXES.has(parts[0].toLowerCase())) parts.shift();
  return parts[0].toLowerCase();
}

export type ManagedLine = { kind: 'entry' | 'disabled'; entry: string; raw: string };
export type ListingLine = ManagedLine | { kind: 'comment' | 'blank' | 'invalid'; raw: string };
export const isManaged = (l: ListingLine): l is ManagedLine => l.kind === 'entry' || l.kind === 'disabled';

/** Une ligne par élément ; la dernière ligne vide d'un fichier terminé par un saut de ligne n'est pas comptée. */
export function parseListing(text: string): ListingLine[] {
  const rows = text.split(/\r?\n/);
  if (rows.length && rows[rows.length - 1] === '') rows.pop();
  return rows.map((raw): ListingLine => {
    const t = raw.trim();
    if (t === '') return { kind: 'blank', raw };
    if (t.startsWith('#')) {
      const rest = t.slice(1).trim();
      return isValidEntry(rest) ? { kind: 'disabled', entry: rest, raw } : { kind: 'comment', raw };
    }
    return isValidEntry(t) ? { kind: 'entry', entry: t, raw } : { kind: 'invalid', raw };
  });
}

export function serializeListing(lines: ListingLine[]): string {
  if (!lines.length) return '';
  return lines.map((l) => (l.kind === 'entry' ? l.entry : l.kind === 'disabled' ? `# ${l.entry}` : l.raw)).join('\n') + '\n';
}

export async function readListing(file: string): Promise<{ exists: boolean; lines: ListingLine[] }> {
  try { return { exists: true, lines: parseListing(await readFile(file, 'utf8')) }; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, lines: [] }; throw err; }
}

export async function writeListing(file: string, lines: ListingLine[]): Promise<void> {
  await atomicWriteFile(file, serializeListing(lines));
}
