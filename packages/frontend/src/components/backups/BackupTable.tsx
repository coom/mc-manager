import { useTranslation } from 'react-i18next';
import { Download, Trash2 } from 'lucide-react';
import type { BackupEntry } from '@mc/common';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';

export function BackupTable({ entries, isAdmin, onDelete, onDownload }: { entries: BackupEntry[]; isAdmin: boolean; onDelete: (n: string) => void; onDownload: (n: string) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('backups.name')}</th><th>{t('backups.date')}</th><th>{t('backups.size')}</th>{isAdmin && <th />}</tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.name} className="border-t">
            <td className="py-2 font-mono">{e.name}</td>
            <td>{new Date(e.modifiedAt).toLocaleString(i18n.language)}</td>
            <td>{formatBytes(e.size)}</td>
            {isAdmin && <td className="text-right">
              <Button size="icon" variant="ghost" aria-label="download" onClick={() => onDownload(e.name)}><Download className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label="delete" className="text-destructive" onClick={() => onDelete(e.name)}><Trash2 className="h-4 w-4" /></Button>
            </td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
