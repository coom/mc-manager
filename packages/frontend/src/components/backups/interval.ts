import { intervalToMinutes, type BackupIntervalUnit } from '@mc/common';

export const UNIT_MINUTES: Record<BackupIntervalUnit, number> = { m: 1, h: 60, d: 1440 };

/** Plus grande unité exacte (jours, heures, minutes) ; null si la valeur n'est pas un nombre entier et positif de minutes. */
export function splitInterval(value: string): { amount: number; unit: BackupIntervalUnit } | null {
  const minutes = intervalToMinutes(value);
  if (minutes === null || !Number.isInteger(minutes) || minutes <= 0) return null;
  for (const unit of ['d', 'h', 'm'] as const) {
    if (minutes % UNIT_MINUTES[unit] === 0) return { amount: minutes / UNIT_MINUTES[unit], unit };
  }
  return null;
}
