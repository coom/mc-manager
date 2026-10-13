import { BACKUP_INTERVAL_FILE_RE, BACKUP_INTERVAL_MAX_MINUTES, BACKUP_INTERVAL_MIN_MINUTES, PRUNE_DAYS_FILE_RE, PRUNE_DAYS_MAX, PRUNE_DAYS_MIN, intervalToMinutes } from '@mc/common';
import type { BackupSettingValue, BackupSettingsUpdate } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';
import { envMap } from '../mods/server-type.js';

/** Fichier de réglages lu par le point d'entrée de mc-backup, relatif au dossier des backups. */
export const SETTINGS_RELATIVE = '.mc-manager/backup-settings.conf';
const DEFAULT_INTERVAL = '24h';
const DEFAULT_PRUNE_DAYS = '7';

export type CmdLike = string[] | string | null | undefined;
export interface SettingsFileValues { interval?: string; pruneDays?: string }

const asText = (v: CmdLike): string => (Array.isArray(v) ? v.join(' ') : v ?? '');

/** Le point d'entrée (ou la commande) de mc-backup lit notre fichier : l'extrait de compose est installé. */
export function isManaged(entrypoint: CmdLike, cmd: CmdLike): boolean {
  return `${asText(entrypoint)} ${asText(cmd)}`.includes(SETTINGS_RELATIVE);
}

/**
 * Relit le fichier exactement comme le `while IFS='=' read -r k v` du compose : seules les lignes terminées
 * par \n comptent, clé avant le premier `=`, aucun rognage (ni espace ni \r), mêmes regex, dernière occurrence gagnante.
 */
export function parseSettingsFile(text: string): SettingsFileValues {
  const out: SettingsFileValues = {};
  for (const line of text.split('\n').slice(0, -1)) {
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (k === 'BACKUP_INTERVAL' && BACKUP_INTERVAL_FILE_RE.test(v)) out.interval = v;
    if (k === 'PRUNE_BACKUPS_DAYS' && PRUNE_DAYS_FILE_RE.test(v)) out.pruneDays = v;
  }
  return out;
}

export function serializeSettings(s: BackupSettingsUpdate): string {
  return `BACKUP_INTERVAL=${s.interval}\nPRUNE_BACKUPS_DAYS=${s.pruneDays}\n`;
}

function invalid(message: string): never { throw new AppError(400, message, undefined, 'invalid'); }

/** Contrôle le corps de PUT /api/backups/settings et n'en garde que les deux champs connus. */
export function validateUpdate(body: unknown): BackupSettingsUpdate {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { interval, pruneDays } = b;
  if (typeof interval !== 'string' || !BACKUP_INTERVAL_FILE_RE.test(interval)) invalid('interval must look like 30m, 6h or 2d');
  const minutes = intervalToMinutes(interval) ?? 0;
  if (minutes < BACKUP_INTERVAL_MIN_MINUTES || minutes > BACKUP_INTERVAL_MAX_MINUTES) {
    invalid(`interval must be between ${BACKUP_INTERVAL_MIN_MINUTES} minutes and ${BACKUP_INTERVAL_MAX_MINUTES / 1440} days`);
  }
  if (typeof pruneDays !== 'number' || !Number.isInteger(pruneDays) || pruneDays < PRUNE_DAYS_MIN || pruneDays > PRUNE_DAYS_MAX) {
    invalid(`pruneDays must be an integer between ${PRUNE_DAYS_MIN} and ${PRUNE_DAYS_MAX}`);
  }
  return { interval, pruneDays };
}

/**
 * Échec d'écriture du fichier de réglages, traduit pour le volume des backups (et non celui des données) ;
 * `backupsDir` est le dossier des backups côté backend.
 */
export function settingsWriteError(err: unknown, file: string, backupsDir: string): AppError {
  const fail = (message: string) => new AppError(500, `Cannot write ${file}: ${message}`, undefined, 'write_failed');
  switch ((err as NodeJS.ErrnoException).code) {
    case 'EROFS': return fail('the backups volume is mounted read-only in MC Manager. Remove :ro from the backups volume in docker-compose.yml.');
    case 'ENOSPC': return fail('no space left on the backups volume.');
    case 'EACCES':
    case 'EPERM': return fail(`the backups directory ${backupsDir} is not writable by the backend (UID 1000). Fix its ownership on the host, see README "Volume ownership".`);
    case 'EEXIST':
    case 'ENOTDIR': return fail(`a file named .mc-manager is in the way in ${backupsDir}. Remove or rename it.`);
    default: return fail((err as Error).message);
  }
}

const nonEmpty = (v: string | undefined): string | undefined => (v ? v : undefined);

/** Valeurs effectives : fichier (déjà filtré par parseSettingsFile) → environnement du conteneur → défauts de l'image. */
export function effectiveSettings(file: SettingsFileValues, env: string[]): { interval: BackupSettingValue; pruneDays: BackupSettingValue } {
  const vars = envMap(env);
  const pick = (fromFile: string | undefined, fromEnv: string | undefined, def: string): BackupSettingValue => {
    if (fromFile !== undefined) return { value: fromFile, source: 'file' };
    if (fromEnv !== undefined) return { value: fromEnv, source: 'compose' };
    return { value: def, source: 'default' };
  };
  return {
    // Comme l'image : BACKUP_INTERVAL:=${INTERVAL_SEC:-24h}, une valeur vide vaut absente.
    interval: pick(file.interval, nonEmpty(vars.get('BACKUP_INTERVAL')) ?? nonEmpty(vars.get('INTERVAL_SEC')), DEFAULT_INTERVAL),
    pruneDays: pick(file.pruneDays, nonEmpty(vars.get('PRUNE_BACKUPS_DAYS')), DEFAULT_PRUNE_DAYS),
  };
}
