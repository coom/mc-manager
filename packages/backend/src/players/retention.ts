import type { PrismaClient } from '../../generated/prisma/index.js';

const KEY = 'journal.retentionDays';
export const DEFAULT_RETENTION_DAYS = 90;
export const MAX_RETENTION_DAYS = 3650;

/** Jours de rétention du journal ; 0 = illimité. Défaut 90 si absent ou invalide. */
export async function loadRetentionDays(prisma: PrismaClient): Promise<number> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    const n = row ? parseInt(row.value, 10) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= MAX_RETENTION_DAYS ? n : DEFAULT_RETENTION_DAYS;
  } catch { return DEFAULT_RETENTION_DAYS; }
}

export async function saveRetentionDays(prisma: PrismaClient, days: number): Promise<void> {
  const value = String(Math.max(0, Math.min(MAX_RETENTION_DAYS, Math.floor(days))));
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}
