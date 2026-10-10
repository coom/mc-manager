import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
export function BackupRunPanel({ lines, running }: { lines: string[]; running: boolean }) {
  const { t } = useTranslation();
  if (!running && lines.length === 0) return null;
  return (
    <div className="rounded-md border bg-black/40 p-3 font-mono text-xs">
      <div className="mb-1 flex items-center gap-2 text-muted-foreground">{running && <Loader2 className="h-3 w-3 animate-spin" />}{running ? t('backups.running') : t('backups.finished')}</div>
      {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap">{l}</div>)}
    </div>
  );
}
