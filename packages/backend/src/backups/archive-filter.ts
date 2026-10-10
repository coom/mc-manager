import { lstat, open, readdir, rm, type FileHandle } from 'fs/promises';
import path from 'path';
import * as tar from 'tar';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export const MAX_ENTRIES = 200_000;
export const MAX_BYTES = 20 * 1024 ** 3;
const ACCEPTED_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory']);
/** Exclusions par défaut de `itzg/mc-backup` (variable `EXCLUDES`) : jamais dans les archives, donc conservées. */
export const DEFAULT_EXCLUDES = ['*.jar', 'cache', 'logs', '*.tmp'];
/** Marqueur de restauration en cours, écrit dans dataDir ; jamais traité comme une entrée d'archive. */
export const RESTORE_MARKER = '.mc-manager-restore.json';

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

/** Glob shell sur un nom de base : `*` → n'importe quelle suite, `?` → un caractère, le reste littéral (sensible à la casse). */
export function globToRegExp(pattern: string): RegExp {
  const body = [...pattern].map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${body}$`, 's');
}

export function matchesAny(name: string, patterns: RegExp[]): boolean { return patterns.some((re) => re.test(name)); }

/**
 * Supprime `target` sauf ce qui correspond aux exclusions (sur le nom de base) : un fichier exclu est gardé,
 * un dossier exclu est gardé en entier, un dossier qui contient encore des éléments gardés est conservé,
 * les autres sont supprimés. Renvoie vrai si quelque chose a été gardé.
 */
export async function removeExcept(target: string, excludes: string[]): Promise<boolean> {
  const patterns = excludes.map(globToRegExp);
  const walk = async (p: string): Promise<boolean> => {
    const st = await lstat(p).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return null; throw err; });
    if (!st) return false;
    if (matchesAny(path.basename(p), patterns)) return true;
    if (!st.isDirectory()) { await rm(p, { force: true }); return false; }
    let kept = false;
    for (const name of await readdir(p)) if (await walk(path.join(p, name))) kept = true;
    if (!kept) await rm(p, { recursive: true, force: true });
    return kept;
  };
  return walk(target);
}

export interface ArchiveInfo { entries: number; bytes: number; topLevel: string[] }
type EntryLike = { path: string; type?: string | number; linkpath?: string; size?: number };

/** Archive ouverte une fois : toutes les lectures passent par le même descripteur (survit à un unlink/prune). */
export interface ArchiveHandle {
  inspect(): Promise<ArchiveInfo>;
  extract(cwd: string, filter: (p: string, entry: EntryLike) => boolean, onReadEntry: (entry: EntryLike) => void): Promise<void>;
  close(): Promise<void>;
}

/** Entrée racine (`./`) produite par `tar -C dir .` : sans effet, ignorée. */
const isRootEntry = (p: string, type: string) => type === 'Directory' && normalizeEntryPath(p) === '';
const topOf = (p: string) => normalizeEntryPath(p).split('/')[0];
const isMarker = (p: string) => topOf(p) === RESTORE_MARKER;

/** Envoie tout le fichier (depuis l'octet 0) dans un flux tar et attend sa fin. */
function pump(fh: FileHandle, sink: NodeJS.WritableStream & NodeJS.EventEmitter): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const src = fh.createReadStream({ start: 0, autoClose: false });
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return; settled = true;
      if (err) { src.destroy(); reject(err); } else resolve();
    };
    src.on('error', finish);
    sink.on('error', finish);
    sink.on('end', () => finish());
    sink.on('close', () => finish());
    src.pipe(sink);
  });
}

export async function openArchive(file: string): Promise<ArchiveHandle> {
  const fh = await open(file, 'r');
  let closed = false;
  const isGzip = async () => {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  };
  return {
    async inspect() {
      if (!(await isGzip())) throw new AppError(400, 'Unsupported archive format (gzip only)');
      let entries = 0; let bytes = 0; let invalid: string | null = null;
      const top = new Set<string>();
      try {
        await pump(fh, tar.list({
          strict: true,
          onReadEntry: (entry) => {
            if (invalid || isRootEntry(entry.path, String(entry.type))) return;
            const reason = validateEntry(entry.path, String(entry.type), entry.linkpath);
            if (reason) { invalid = reason; return; }
            entries++; bytes += Number(entry.size ?? 0);
            if (entries > MAX_ENTRIES) invalid = `more than ${MAX_ENTRIES} entries`;
            else if (bytes > MAX_BYTES) invalid = `more than ${MAX_BYTES} bytes uncompressed`;
            const t = topOf(entry.path); if (t && t !== RESTORE_MARKER) top.add(t);
          },
        }) as unknown as NodeJS.WritableStream & NodeJS.EventEmitter);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(400, 'Corrupt or unreadable archive', (err as Error).message);
      }
      if (invalid) throw new AppError(400, `Archive rejected: ${invalid}`);
      return { entries, bytes, topLevel: [...top] };
    },
    async extract(cwd, filter, onReadEntry) {
      await pump(fh, tar.extract({
        cwd, strict: true, preservePaths: false,
        filter: (p, entry) => filter(p, entry as unknown as EntryLike),
        onReadEntry: (entry) => onReadEntry(entry),
      }) as unknown as NodeJS.WritableStream & NodeJS.EventEmitter);
    },
    async close() { if (closed) return; closed = true; await fh.close(); },
  };
}

export async function isGzipFile(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(2);
    const { bytesRead } = await fh.read(buf, 0, 2, 0);
    return bytesRead === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally { await fh.close(); }
}

/** Parcourt l'archive sans extraire : valide chaque entrée, compte, et liste les entrées de premier niveau. */
export async function inspectArchive(file: string): Promise<ArchiveInfo> {
  const h = await openArchive(file);
  try { return await h.inspect(); } finally { await h.close(); }
}

export interface RestoreArchiveOptions {
  excludes: string[];
  /** Inspection déjà faite (évite une seconde lecture). */
  info?: ArchiveInfo;
  /** Appelé une fois, juste avant la première suppression (marqueur, suivi de l'état « touché »). */
  onBeforeReplace?: () => Promise<void> | void;
  /** Appelé une fois, juste avant l'extraction. */
  onBeforeExtract?: () => Promise<void> | void;
}

/**
 * Restauration : chaque entrée de premier niveau de l'archive remplace son homologue dans dataDir, sauf les
 * chemins exclus par mc-backup (jars, cache, logs, *.tmp par défaut) qui n'y sont jamais et sont donc gardés ;
 * puis l'archive est extraite avec le même filtre qu'à l'inspection. Rien n'est écrit hors dataDir.
 */
export async function restoreArchive(source: string | ArchiveHandle, dataDir: string, onProgress: (line: string) => void,
  opts: RestoreArchiveOptions = { excludes: DEFAULT_EXCLUDES }): Promise<void> {
  const handle = typeof source === 'string' ? await openArchive(source) : source;
  try {
    const root = path.resolve(dataDir);
    const info = opts.info ?? await handle.inspect();
    for (const name of info.topLevel) {
      const target = path.resolve(root, name);
      if (path.dirname(target) !== root) throw new AppError(400, `Archive rejected: top-level entry ${name}`);
    }
    await opts.onBeforeReplace?.();
    for (const name of info.topLevel) {
      onProgress(`replace ${name}`);
      await removeExcept(path.resolve(root, name), opts.excludes);
    }
    await opts.onBeforeExtract?.();
    let n = 0;
    await handle.extract(root,
      // La racine est ignorée : node-tar ferait un utimes sur cwd (EPERM si dataDir n'appartient pas à l'UID 1000).
      (p, entry) => {
        const type = String(entry.type);
        return !isRootEntry(p, type) && !isMarker(p) && validateEntry(p, type, entry.linkpath) === null;
      },
      (entry) => {
        n++;
        const norm = normalizeEntryPath(entry.path);
        if (n % 200 === 0 || !norm.includes('/')) onProgress(`extract ${norm} (${n}/${info.entries})`);
      });
    logger.info({ entries: n }, 'archive restored');
  } finally {
    if (typeof source === 'string') await handle.close();
  }
}
