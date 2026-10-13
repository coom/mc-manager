import type { TFunction } from 'i18next';
import type { BackupDeleteErrorCode } from '@mc/common';
import type { ApiError } from '@/components/mods/mods-errors';

const CODES: ReadonlySet<string> = new Set<BackupDeleteErrorCode>(['invalid_names', 'retention_unknown', 'retention_disabled']);

/** Erreur d'une suppression multiple ou de la rétention : traduite par code, sinon message du serveur. */
export function describeBackupError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  if (code && CODES.has(code)) return t(`backups.errors.${code}`);
  return e.response?.data?.error ?? t('shared.error');
}
