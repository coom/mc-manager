import { mkdir, writeFile, rename, rm, stat, chmod } from 'fs/promises';
import path from 'path';
import { AppError } from '../middleware/error-handler.js';
import { logger } from './logger.js';

/** Écrit `content` dans `file` via un fichier temporaire puis rename ; crée le dossier parent. */
export async function atomicWriteFile(file: string, content: string): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(tmp, content, 'utf8');
    try { await chmod(tmp, (await stat(file)).mode & 0o777); } catch { /* fichier absent ou Windows */ }
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw mapWriteError(err, file, dir);
  }
}

/** Traduit EROFS/ENOSPC/EACCES en AppError 500 explicite ; renvoie l'erreur d'origine sinon. */
export function mapWriteError(err: unknown, file: string, dir: string): unknown {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EROFS') return new AppError(500, `Cannot write ${file}: the data volume is mounted read-only. Remove :ro from the data volume in docker-compose.yml.`);
  if (code === 'ENOSPC') return new AppError(500, `Cannot write ${file}: no space left on the data volume.`);
  if (code === 'EACCES' || code === 'EPERM') {
    logger.warn({ err, file }, 'cannot write in data directory');
    return new AppError(500, `Cannot write ${file}: the data directory is not writable by the backend (UID 1000). Run chown -R 1000:1000 ${dir} on the host.`);
  }
  return err;
}
