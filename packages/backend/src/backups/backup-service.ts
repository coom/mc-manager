import { EventEmitter } from 'events';
import { readdir, stat, unlink } from 'fs/promises';
import path from 'path';
import { PassThrough } from 'stream';
import type { BackupList } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(tgz|tar\.gz)$/;
export function isSafeBackupName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..') && path.basename(name) === name;
}

export class BackupService extends EventEmitter {
  private running = false;
  constructor(
    private dir: string,
    private docker: DockerService,
    private lock: DataLock = new DataLock(),
    /** Rétention du fichier de réglages : `backup now` hérite de Config.Env, pas de l'environnement de la boucle. */
    private pruneDays: () => Promise<number | null> = async () => null,
  ) { super(); }

  get dataLock(): DataLock { return this.lock; }

  isRunning(): boolean { return this.running; }

  async ensureContainer(): Promise<void> {
    if (!(await this.docker.hasBackupContainer())) throw new AppError(503, 'Backup container not found');
  }

  async list(): Promise<BackupList> {
    const names = await readdir(this.dir).catch((err: NodeJS.ErrnoException) => {
      logger.warn({ err, dir: this.dir }, "cannot read backups directory");
      return [] as string[];
    });
    const entries = [];
    for (const name of names) {
      if (!isSafeBackupName(name)) continue;
      const s = await stat(path.join(this.dir, name)).catch(() => null);
      if (!s?.isFile()) continue;
      entries.push({ name, size: s.size, modifiedAt: s.mtime.toISOString() });
    }
    entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return { entries, totalBytes: entries.reduce((n, e) => n + e.size, 0), running: this.running };
  }

  async resolve(name: string): Promise<string> {
    if (!isSafeBackupName(name)) throw new AppError(404, 'Backup not found');
    // Chemin absolu (requis par res.sendFile) même si MC_BACKUPS_DIR est relatif.
    const full = path.resolve(this.dir, name);
    if (path.dirname(full) !== path.resolve(this.dir)) throw new AppError(404, 'Backup not found');
    const s = await stat(full).catch(() => null);
    if (!s?.isFile()) throw new AppError(404, 'Backup not found');
    return full;
  }

  async remove(name: string): Promise<void> {
    this.lock.assertFree();
    const full = await this.resolve(name);
    await this.unlinkArchive(full);
    this.emit('listChanged');
  }

  /**
   * Supprime plusieurs archives sous le verrou : tous les noms sont vérifiés avant la première suppression
   * (un seul inconnu = 404, rien supprimé). `onDeleted` est appelé après chaque fichier supprimé (audit).
   */
  async removeMany(names: string[], onDeleted?: (name: string) => Promise<void> | void): Promise<string[]> {
    const release = this.lock.acquire('delete');
    const deleted: string[] = [];
    try {
      const targets: [string, string][] = [];
      for (const name of new Set(names)) targets.push([name, await this.resolve(name)]);
      for (const [name, full] of targets) {
        await this.unlinkArchive(full);
        deleted.push(name);
        await onDeleted?.(name);
      }
      return deleted;
    } finally {
      release();
      if (deleted.length > 0) this.emit('listChanged');
    }
  }

  private async unlinkArchive(full: string): Promise<void> {
    try {
      await unlink(full);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        logger.warn({ err, file: full }, 'cannot delete backup: directory not writable by the backend user');
        throw new AppError(500, 'Cannot delete backup: the backups directory is not writable by the backend (UID 1000). Fix ownership on the host, see README "Volume ownership".');
      }
      throw err;
    }
  }

  /**
   * Lance `backup now` et résout avec le code de sortie (rejette si le conteneur est injoignable).
   * `lockHeld` : l'appelant tient déjà le verrou (sauvegarde de sécurité d'une restauration).
   */
  async runNow(opts: { lockHeld?: boolean } = {}): Promise<number> {
    if (this.running) throw new AppError(409, 'A backup is already running');
    const release = opts.lockHeld ? () => undefined : this.lock.acquire('backup');
    this.running = true;
    try {
      const days = await this.pruneDays().catch(() => null);
      const { stream, wait } = await this.docker.execBackup(['backup', 'now'], days !== null ? [`PRUNE_BACKUPS_DAYS=${days}`] : undefined);
      const text = new PassThrough();
      this.docker.demux(stream, text);
      let partial = '';
      text.on('data', (chunk: Buffer) => {
        partial += chunk.toString('utf8');
        let nl: number;
        while ((nl = partial.indexOf('\n')) >= 0) { const line = partial.slice(0, nl).replace(/\r$/, ''); partial = partial.slice(nl + 1); if (line) this.emit('progress', line); }
      });
      const code = await wait();
      if (partial.trim()) this.emit('progress', partial.trim());
      this.emit('done', code);
      if (code === 0) this.emit('listChanged');
      return code;
    } catch (err) {
      logger.error({ err }, 'backup now failed');
      this.emit('progress', `error: ${(err as Error).message}`);
      this.emit('done', 1);
      throw err instanceof AppError ? err : new AppError(503, 'Backup container unavailable');
    } finally { this.running = false; release(); }
  }
}
