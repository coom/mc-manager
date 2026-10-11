import type { TFunction } from 'i18next';

export type ApiError = { response?: { data?: { error?: string; code?: string; details?: string } } };

const CODES = new Set([
  'invalid_entry', 'duplicate', 'unknown_project', 'wrong_type', 'loader_mismatch', 'modrinth_unavailable', 'unsupported_server', 'busy', 'conflict', 'not_found',
  'invalid_query', 'invalid_name', 'too_large', 'upload_aborted', 'not_a_jar', 'wrong_loader', 'exists', 'managed', 'duplicate_mod',
]);

/** Message traduit par code quand le backend en fournit un (details alimente {{detected}} / {{other}}), sinon son message brut, sinon l'erreur générique. */
export function describeModsError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  const details = e.response?.data?.details;
  if (code && CODES.has(code)) return t(`mods.errors.${code}`, { detected: details ?? '?', other: details ?? '?' });
  return e.response?.data?.error ?? t('shared.error');
}
