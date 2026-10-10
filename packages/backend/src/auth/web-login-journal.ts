import type { PrismaClient } from '../../generated/prisma/index.js';
import type { WebLoginReason } from '@mc/common';
import { lookupCountry, normalizeIp } from '../utils/geo.js';
import { logger } from '../utils/logger.js';

export interface WebLoginRecord {
  username: string;
  userId: number | null;
  ip: string | undefined;
  success: boolean;
  reason?: WebLoginReason | null;
}

/**
 * Journalise une tentative de connexion à MC Manager. « Au mieux » : la promesse n'est pas
 * attendue et une erreur d'écriture n'atteint jamais la réponse d'authentification.
 */
export function recordWebLogin(prisma: PrismaClient, rec: WebLoginRecord): void {
  const ip = normalizeIp(rec.ip ?? '') || 'unknown';
  const country = lookupCountry(ip).country;
  Promise.resolve()
    .then(() => prisma.webLogin.create({ data: { username: rec.username.slice(0, 64), userId: rec.userId, ip, country, success: rec.success, reason: rec.reason ?? null } }))
    .catch((err) => logger.warn({ err }, 'web login journal write failed'));
}
