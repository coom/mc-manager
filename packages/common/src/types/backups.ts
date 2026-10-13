export interface BackupEntry { name: string; size: number; modifiedAt: string }
export interface BackupList { entries: BackupEntry[]; totalBytes: number; running: boolean }
export type RestoreStep = 'check' | 'safety' | 'stop' | 'replace' | 'extract' | 'start';
/** Restauration interrompue (marqueur `.mc-manager-restore.json` trouvé dans les données). */
export interface InterruptedRestore { archive: string; safetyBackup: string | null; startedAt: string }
export interface RestoreStatus { running: boolean; step: RestoreStep | null; interrupted: InterruptedRestore | null }
export interface RestoreRequest { startAfter?: boolean; confirmNoSafetyBackup?: boolean }
export interface RestoreResult { ok: boolean; message: string; safetyBackup: string | null }

/** Bornes de l'intervalle entre deux sauvegardes réglable depuis l'interface, en minutes (30 min à 7 jours). */
export const BACKUP_INTERVAL_MIN_MINUTES = 30;
export const BACKUP_INTERVAL_MAX_MINUTES = 7 * 24 * 60;
/** Bornes de la rétention (PRUNE_BACKUPS_DAYS) : 0, « ne jamais supprimer », est refusé. */
export const PRUNE_DAYS_MIN = 1;
export const PRUNE_DAYS_MAX = 365;
export const BACKUP_INTERVAL_UNITS = ['m', 'h', 'd'] as const;
export type BackupIntervalUnit = (typeof BACKUP_INTERVAL_UNITS)[number];

/** Fichier de réglages tel que mc-backup le voit (volume des backups monté sur /backups). */
export const BACKUP_SETTINGS_FILE_IN_CONTAINER = '/backups/.mc-manager/backup-settings.conf';
/** Valeurs acceptées par le point d'entrée du compose ; le backend relit le fichier avec les mêmes regex. */
export const BACKUP_INTERVAL_FILE_RE = /^[1-9][0-9]*[mhd]$/;
export const PRUNE_DAYS_FILE_RE = /^[1-9][0-9]*$/;

/**
 * Bloc `entrypoint:` à coller sous le service mc-backup (indenté de 4 espaces). Ne fait jamais `source` du
 * fichier : seules deux clés sont exportées, après validation. `$$` est l'échappement de compose.
 */
export const BACKUP_SETTINGS_COMPOSE_SNIPPET = [
  '    entrypoint:',
  '      - /bin/bash',
  '      - -c',
  '      - |',
  `        f=${BACKUP_SETTINGS_FILE_IN_CONTAINER}`,
  '        if [ -r "$$f" ]; then',
  "          while IFS='=' read -r k v; do",
  '            case "$$k" in',
  '              BACKUP_INTERVAL) [[ "$$v" =~ ^[1-9][0-9]*[mhd]$$ ]] && export BACKUP_INTERVAL="$$v" ;;',
  '              PRUNE_BACKUPS_DAYS) [[ "$$v" =~ ^[1-9][0-9]*$$ ]] && export PRUNE_BACKUPS_DAYS="$$v" ;;',
  '            esac',
  '          done < "$$f"',
  '        fi',
  '        exec /usr/bin/backup loop',
].join('\n');

export type BackupSettingSource = 'file' | 'compose' | 'default';
export interface BackupSettingValue { value: string; source: BackupSettingSource }
export interface BackupSettings {
  containerFound: boolean;
  running: boolean;
  /** Le point d'entrée de mc-backup lit le fichier de réglages : modification possible depuis l'interface. */
  managed: boolean;
  /** Non nul : planification cron de l'image, l'intervalle ne s'applique pas. */
  cronSchedule: string | null;
  /** Valeurs brutes telles que mc-backup les voit ; null si le conteneur est introuvable. */
  interval: BackupSettingValue | null;
  pruneDays: BackupSettingValue | null;
  /** Fichier modifié après le dernier démarrage de mc-backup : pas encore appliqué. */
  pendingRestart: boolean;
  initialDelay: string;
  backupOnStartup: boolean;
}
export interface BackupSettingsUpdate { interval: string; pruneDays: number }
export type BackupSettingsErrorCode = 'invalid' | 'not_managed' | 'busy' | 'container_missing' | 'restart_failed';

const UNIT_TO_MINUTES: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1440 };
/** `30m`, `6h`, `7d`, `90s` ou nombre nu en secondes (comme `sleep`) → minutes ; null si non reconnu. */
export function intervalToMinutes(value: string): number | null {
  const m = /^(\d+)([smhd]?)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * UNIT_TO_MINUTES[m[2] || 's'];
}
