import type { TFunction } from 'i18next';

/** Noms d'archives pour une confirmation : les `max` premiers, puis « et N autres ». */
export function summarizeNames(names: string[], t: TFunction, max = 10): string {
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? t('backups.more', { names: shown, count: names.length - max }) : shown;
}
