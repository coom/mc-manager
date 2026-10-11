import type { TFunction } from 'i18next';

export type ApiError = { response?: { data?: { error?: string; code?: string } } };

const CODES = new Set(['invalid_entry', 'duplicate', 'unknown_project', 'wrong_type', 'loader_mismatch', 'modrinth_unavailable', 'unsupported_server', 'busy', 'conflict', 'not_found']);

/** Message traduit par code quand le backend en fournit un, sinon son message brut, sinon l'erreur générique. */
export function describeModsError(e: ApiError, t: TFunction): string {
  const code = e.response?.data?.code;
  if (code && CODES.has(code)) return t(`mods.errors.${code}`);
  return e.response?.data?.error ?? t('shared.error');
}
