import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { RestoreResult } from '@mc/common';
import { Button } from '@/components/ui/button';

interface Props { lines: string[]; running: boolean; mode?: 'backup' | 'restore'; result?: RestoreResult | null; onRestoreSafety?: (name: string) => void }

/** Sortie en direct d'une sauvegarde manuelle ou d'une restauration, puis le résultat. */
export function BackupRunPanel({ lines, running, mode = 'backup', result = null, onRestoreSafety }: Props) {
  const { t } = useTranslation();
  if (!running && lines.length === 0 && !result) return null;
  const title = running ? t(mode === 'restore' ? 'backups.restoring' : 'backups.running')
    : mode === 'restore' && result ? t(result.ok ? 'backups.restoreDone' : 'backups.restoreFailed') : t('backups.finished');
  return (
    <div className="rounded-md border bg-black/40 p-3 font-mono text-xs">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : result ? (result.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />) : null}
        {title}
      </div>
      {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
      {!running && result && !result.ok && <div className="mt-1 text-red-400">{result.message}</div>}
      {!running && result && result.safetyBackup && (
        <div className="mt-2 flex items-center gap-2">
          <span>{t('backups.restoreSafety', { name: result.safetyBackup })}</span>
          {!result.ok && onRestoreSafety && <Button size="sm" variant="outline" onClick={() => onRestoreSafety(result.safetyBackup!)}>{t('backups.restoreThis')}</Button>}
        </div>
      )}
    </div>
  );
}
