import type { BackupEntry, BackupSettings } from '@mc/common';
import { AppError } from '../middleware/error-handler.js';

const DAY_MS = 86_400_000;

/**
 * Archives plus anciennes que la rétention (comme le `find -mmin +N` de mc-backup), à partir d'une liste triée
 * de la plus récente à la plus ancienne. La plus récente n'est jamais proposée, même si elle dépasse la rétention.
 */
export function pruneCandidates(entries: BackupEntry[], days: number, now: number): BackupEntry[] {
  const limit = now - days * DAY_MS;
  return entries.slice(1).filter((e) => Date.parse(e.modifiedAt) < limit);
}

/** Rétention effective affichée sur la page ; 409 si elle est inconnue ou si mc-backup ne nettoie pas par âge. */
export function retentionDays(settings: BackupSettings): number {
  if (!settings.pruneDays) throw new AppError(409, 'Retention unknown: the backup container was not found', undefined, 'retention_unknown');
  const v = settings.pruneDays.value;
  // `(( PRUNE_BACKUPS_DAYS > 0 ))` dans l'image : seul un entier positif déclenche le nettoyage par âge.
  if (!/^[0-9]+$/.test(v) || Number(v) <= 0) throw new AppError(409, `Retention disabled (PRUNE_BACKUPS_DAYS=${v})`, undefined, 'retention_disabled');
  return Number(v);
}
