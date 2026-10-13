import type { TFunction } from 'i18next';
import type { BackupSettingsErrorCode } from '@mc/common';
import type { ApiError } from '@/components/mods/mods-errors';

const CODES: ReadonlySet<string> = new Set<BackupSettingsErrorCode>(['invalid', 'not_managed', 'busy', 'container_missing', 'restart_failed']);

/** Message traduit par code quand le backend en fournit un, sinon son message brut, sinon l'erreur générique. */
export function describeBackupSettingsError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  if (code && CODES.has(code)) return t(`backups.schedule.errors.${code}`);
  return e.response?.data?.error ?? t('shared.error');
}
