import { open, rm } from 'fs/promises';
import path from 'path';
import * as tar from 'tar';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export const MAX_ENTRIES = 200_000;
export const MAX_BYTES = 20 * 1024 ** 3;
const ACCEPTED_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);

/** Retire les `./` de tête et le `/` final ; ne touche pas aux chemins absolus (refusés ensuite). */
export function normalizeEntryPath(p: string): string {
  let out = p.replace(/\\/g, '/');
  while (out.startsWith('./')) out = out.slice(2);
  while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
  return out === '.' ? '' : out;
}

/** Raison du refus, ou null si l'entrée peut être extraite dans /data. */
export function validateEntry(entryPath: string, type: string, linkpath?: string): string | null {
  if (!ACCEPTED_TYPES.has(type)) return `unsupported entry type ${type}${linkpath ? ` -> ${linkpath}` : ''}`;
  const p = normalizeEntryPath(entryPath);
  if (!p) return 'empty path';
  if (p.includes('\0')) return 'path contains NUL';
  if (path.posix.isAbsolute(p) || /^[A-Za-z]:/.test(p)) return `absolute path ${p}`;
  if (p.split('/').some((seg) => seg === '..')) return `path escapes the data dir: ${p}`;
  return null;
}

export async function isGzipFile(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally { await fh.close(); }
}

/** Entrée racine (`./`) produite par `tar -C dir .` : sans effet, ignorée avant validation. */
const isRootEntry = (p: string, type: string) => type === 'Directory' && normalizeEntryPath(p) === '';

const topOf = (p: string) => normalizeEntryPath(p).split('/')[0];

/** Parcourt l'archive sans extraire : valide chaque entrée, compte, et liste les entrées de premier niveau. */
export async function inspectArchive(file: string): Promise<{ entries: number; bytes: number; topLevel: string[] }> {
  if (!(await isGzipFile(file))) throw new AppError(400, 'Unsupported archive format (gzip only)');
  let entries = 0; let bytes = 0; let invalid: string | null = null;
  const top = new Set<string>();
  try {
    await tar.list({
      file, strict: true,
      onReadEntry: (entry) => {
        if (invalid || isRootEntry(entry.path, String(entry.type))) return;
        const reason = validateEntry(entry.path, String(entry.type), entry.linkpath);
        if (reason) { invalid = reason; return; }
        entries++; bytes += Number(entry.size ?? 0);
        if (entries > MAX_ENTRIES) invalid = `more than ${MAX_ENTRIES} entries`;
        else if (bytes > MAX_BYTES) invalid = `more than ${MAX_BYTES} bytes uncompressed`;
        const t = topOf(entry.path); if (t) top.add(t);
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Corrupt or unreadable archive', (err as Error).message);
  }
  if (invalid) throw new AppError(400, `Archive rejected: ${invalid}`);
  return { entries, bytes, topLevel: [...top] };
}

/**
 * Restauration : chaque entrée de premier niveau de l'archive remplace son homologue dans dataDir,
 * puis l'archive est extraite avec le même filtre qu'à l'inspection. Rien n'est écrit hors dataDir.
 */
export async function restoreArchive(file: string, dataDir: string, onProgress: (line: string) => void): Promise<void> {
  const root = path.resolve(dataDir);
  const info = await inspectArchive(file);
  for (const name of info.topLevel) {
    const target = path.resolve(root, name);
    if (path.dirname(target) !== root) throw new AppError(400, `Archive rejected: top-level entry ${name}`);
    onProgress(`replace ${name}`);
    await rm(target, { recursive: true, force: true });
  }
  let n = 0;
  await tar.extract({
    file, cwd: root, strict: true, preservePaths: false,
    filter: (p, entry) => {
      const type = String((entry as { type?: string }).type);
      return isRootEntry(p, type) || validateEntry(p, type, (entry as { linkpath?: string }).linkpath) === null;
    },
    onReadEntry: (entry) => {
      n++;
      const norm = normalizeEntryPath(entry.path);
      if (n % 200 === 0 || !norm.includes('/')) onProgress(`extract ${norm} (${n}/${info.entries})`);
    },
  });
  logger.info({ file, entries: n }, 'archive restored');
}
