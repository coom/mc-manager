import { access, readFile, stat } from 'fs/promises';
import path from 'path';
import type { BackupSettings } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { atomicWriteFile } from '../utils/atomic-write.js';
import { logger } from '../utils/logger.js';
import { envMap } from '../mods/server-type.js';
import { SETTINGS_RELATIVE, effectiveSettings, isManaged, parseSettingsFile, serializeSettings, settingsWriteError, validateUpdate, type SettingsFileValues } from './backup-settings.js';

type AuditFn = (detail: string) => Promise<void>;

const isTrue = (v: string | undefined): boolean => (v ?? '').toLowerCase() === 'true';

/**
 * Intervalle et rétention de mc-backup : écrits dans `<backups>/.mc-manager/backup-settings.conf`, que le point
 * d'entrée du compose lit à chaque démarrage ; appliqués en redémarrant mc-backup.
 */
export class BackupSettingsService {
  private readonly file: string;

  constructor(private dir: string, private docker: DockerService, private lock: DataLock) {
    this.file = path.join(dir, SETTINGS_RELATIVE);
  }

  async read(): Promise<BackupSettings> {
    const c = await this.docker.inspectBackup();
    if (!c) {
      return { containerFound: false, running: false, managed: false, cronSchedule: null, interval: null, pruneDays: null, pendingRestart: false, initialDelay: '2m', backupOnStartup: true };
    }
    const vars = envMap(c.env);
    const managed = isManaged(c.entrypoint, c.cmd);
    const file = managed ? await this.readFile() : null;
    const eff = effectiveSettings(file?.values ?? {}, c.env);
    const startedAt = c.startedAt ? Date.parse(c.startedAt) : Number.NaN;
    return {
      containerFound: true,
      running: c.running,
      managed,
      // `[[ -v CRON_SCHEDULE ]]` dans l'image : la présence suffit, même vide.
      cronSchedule: vars.has('CRON_SCHEDULE') ? vars.get('CRON_SCHEDULE') ?? '' : null,
      interval: eff.interval,
      pruneDays: eff.pruneDays,
      pendingRestart: file !== null && (Number.isNaN(startedAt) || file.mtimeMs > startedAt),
      initialDelay: vars.get('INITIAL_DELAY') || '2m',
      backupOnStartup: (vars.get('BACKUP_ON_STARTUP') || 'true').toUpperCase() !== 'FALSE',
    };
  }

  async apply(body: unknown, audit: AuditFn): Promise<BackupSettings> {
    const update = validateUpdate(body);
    const c = await this.docker.inspectBackup();
    if (!c) throw new AppError(503, 'Backup container not found', undefined, 'container_missing');
    const vars = envMap(c.env);
    if (!isManaged(c.entrypoint, c.cmd)) {
      throw new AppError(409, 'The backup container does not read the settings file: add the entrypoint shown in the README to its compose service', undefined, 'not_managed');
    }
    if (vars.has('CRON_SCHEDULE')) throw new AppError(409, 'The backup container is scheduled by CRON_SCHEDULE: the interval does not apply', undefined, 'not_managed');
    const current = await this.read();
    if (!current.pendingRestart && current.interval?.source === 'file' && current.interval.value === update.interval
      && current.pruneDays?.source === 'file' && current.pruneDays.value === String(update.pruneDays)) return current;

    const release = this.lock.acquire('backup-settings');
    try {
      await this.assertNoLoopBackup(vars);
      await atomicWriteFile(this.file, serializeSettings(update), (err) => settingsWriteError(err, this.file, this.dir));
      const detail = `interval=${update.interval} pruneDays=${update.pruneDays}`;
      try {
        await this.docker.restartBackup();
      } catch (err) {
        logger.error({ err }, 'cannot restart the backup container after writing its settings');
        await audit(`${detail} (restart failed)`);
        throw new AppError(502, `Settings saved, but the backup container did not restart: ${(err as Error).message}`, undefined, 'restart_failed');
      }
      await audit(detail);
    } finally {
      release();
    }
    return this.read();
  }

  /** Rétention du fichier pour `backup now` (l'exec hérite de Config.Env, pas du fichier) ; null = valeur du conteneur. */
  async pruneDaysForExec(): Promise<number | null> {
    try {
      const c = await this.docker.inspectBackup();
      if (!c || !isManaged(c.entrypoint, c.cmd)) return null;
      const days = (await this.readFile())?.values.pruneDays;
      return days ? Number(days) : null;
    } catch (err) {
      logger.warn({ err }, 'cannot read the backup retention, using the container value');
      return null;
    }
  }

  private async readFile(): Promise<{ values: SettingsFileValues; mtimeMs: number } | null> {
    try {
      const [text, s] = await Promise.all([readFile(this.file, 'utf8'), stat(this.file)]);
      return { values: parseSettingsFile(text), mtimeMs: s.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, file: this.file }, 'cannot read the backup settings file');
      return null;
    }
  }

  /**
   * Redémarrer pendant une sauvegarde de la boucle laisserait une archive tronquée et le serveur en save-off :
   * mc-backup tient flock sur $DEST_DIR/.mc-backup-lock pendant chaque sauvegarde.
   */
  private async assertNoLoopBackup(vars: Map<string, string>): Promise<void> {
    if (isTrue(vars.get('SKIP_LOCKING'))) return;
    // Sans fichier de verrou, aucune sauvegarde verrouillée n'a jamais tourné ; l'exec le créerait avec son propre propriétaire.
    try { await access(path.join(this.dir, '.mc-backup-lock')); } catch { return; }
    const destDir = vars.get('DEST_DIR') || '/backups';
    let code: number;
    try {
      const r = await this.docker.execBackup(['flock', '-n', `${destDir}/.mc-backup-lock`, 'true']);
      r.stream.resume();
      code = await r.wait();
    } catch (err) {
      logger.warn({ err }, 'cannot check the backup lock, restarting anyway');
      return;
    }
    if (code === 1) throw new AppError(409, 'A backup is running in the backup container, try again when it is done', undefined, 'busy');
    if (code !== 0) logger.warn({ code }, 'backup lock check failed, restarting anyway');
  }
}
