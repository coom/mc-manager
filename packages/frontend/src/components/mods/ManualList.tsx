import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileArchive, Loader2, Trash2 } from 'lucide-react';
import type { ManualMod } from '@mc/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { formatBytes } from '@/lib/utils';
import { UploadDropzone } from './UploadDropzone';
import type { UploadState } from './use-mod-upload';

interface Props {
  mods: ManualMod[]; canAct: boolean; pending: boolean;
  onToggle: (file: string, enabled: boolean) => void;
  onDelete: (file: string) => void;
  upload: { current: UploadState | null; onFiles: (files: File[]) => void; onCancel: () => void };
}

export function ManualList({ mods, canAct, pending, onToggle, onDelete, upload }: Props) {
  const { t } = useTranslation();
  const [toDelete, setToDelete] = useState<ManualMod | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mods.manual.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('mods.manual.description')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {canAct && <UploadDropzone onFiles={upload.onFiles} disabled={pending && !upload.current} />}
        {upload.current && (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono-data text-sm">{upload.current.file.name}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.round(upload.current.progress * 100)}%` }} /></div>
            </div>
            <Button size="sm" variant="ghost" onClick={upload.onCancel}>{t('mods.upload.cancel')}</Button>
          </div>
        )}
        {mods.length === 0 && !upload.current && <p className="text-sm text-muted-foreground">{t('mods.manual.empty')}</p>}
        {mods.map((m) => (
          <div key={m.file} className="flex items-center gap-3 rounded-md border border-border p-2">
            <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              {m.meta?.name ? (
                <>
                  <p className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
                    <span className="truncate">{m.meta.name}</span>
                    {m.meta.version && <Badge variant="outline" className="font-mono-data text-[10px]">{m.meta.version}</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground"><span className="font-mono-data">{m.file}</span><span> · </span><span>{formatBytes(m.size)}</span></p>
                </>
              ) : (
                <>
                  <p className="truncate font-mono-data text-sm">{m.file}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(m.size)}</p>
                </>
              )}
            </div>
            {m.conflict && <Badge variant="destructive" title={t('mods.manual.conflict')}>{t('mods.manual.conflict')}</Badge>}
            {canAct && (
              <>
                <Switch aria-label={m.file} checked={m.enabled} disabled={pending || m.conflict} onCheckedChange={(on) => onToggle(m.file, on)} />
                <Button size="sm" variant="ghost" aria-label={t('mods.manual.delete')} disabled={pending} onClick={() => setToDelete(m)}><Trash2 className="h-4 w-4" /></Button>
              </>
            )}
          </div>
        ))}
      </CardContent>
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => { if (!o) setToDelete(null); }}
        title={t('mods.manual.deleteTitle', { file: toDelete?.file ?? '' })}
        description={toDelete?.conflict ? t('mods.manual.deleteConflictDescription') : t('mods.manual.deleteDescription')}
        destructive loading={pending} onConfirm={() => { if (toDelete) onDelete(toDelete.file); setToDelete(null); }} />
    </Card>
  );
}
