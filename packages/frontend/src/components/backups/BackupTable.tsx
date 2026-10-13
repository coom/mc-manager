import { useTranslation } from 'react-i18next';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import type { BackupEntry } from '@mc/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatBytes } from '@/lib/utils';

export function BackupTable({ entries, isAdmin, busy, onRestore, onDelete, onDownload, selected, onToggle }: {
  entries: BackupEntry[]; isAdmin: boolean; busy: boolean; onRestore: (n: string) => void; onDelete: (n: string) => void; onDownload: (n: string) => void;
  /** Sélection pour la suppression multiple (admins) ; sans `onToggle`, pas de colonne de cases. */
  selected?: ReadonlySet<string>; onToggle?: (n: string, checked: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const selectable = isAdmin && onToggle !== undefined;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr>{selectable && <th className="w-8" />}<th className="py-2">{t('backups.name')}</th><th>{t('backups.date')}</th><th>{t('backups.size')}</th>{isAdmin && <th />}</tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.name} className="border-t">
            {selectable && <td className="py-2 pr-2">
              <Checkbox aria-label={t('backups.select', { name: e.name })} checked={selected?.has(e.name) ?? false} onCheckedChange={(v) => onToggle(e.name, v === true)} />
            </td>}
            <td className="py-2 font-mono">{e.name}</td>
            <td>{new Date(e.modifiedAt).toLocaleString(i18n.language)}</td>
            <td>{formatBytes(e.size)}</td>
            {isAdmin && <td className="text-right">
              <Button size="icon" variant="ghost" aria-label="restore" disabled={busy} onClick={() => onRestore(e.name)}><RotateCcw className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="download" onClick={() => onDownload(e.name)}><Download className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="delete" className="text-destructive" onClick={() => onDelete(e.name)}><Trash2 className="h-4 w-4" /></Button>
            </td>}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}
