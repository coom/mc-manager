import { useTranslation } from 'react-i18next';
import { FileArchive } from 'lucide-react';
import type { ManualMod } from '@mc/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { formatBytes } from '@/lib/utils';

export function ManualList({ mods, canAct, pending, onToggle }: { mods: ManualMod[]; canAct: boolean; pending: boolean; onToggle: (file: string, enabled: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mods.manual.title')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('mods.manual.description')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {mods.length === 0 && <p className="text-sm text-muted-foreground">{t('mods.manual.empty')}</p>}
        {mods.map((m) => (
          <div key={m.file} className="flex items-center gap-3 rounded-md border border-border p-2">
            <FileArchive className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono-data text-sm">{m.file}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(m.size)}</p>
            </div>
            {m.conflict && <Badge variant="destructive" title={t('mods.manual.conflict')}>{t('mods.manual.conflict')}</Badge>}
            {canAct && <Switch aria-label={m.file} checked={m.enabled} disabled={pending || m.conflict} onCheckedChange={(on) => onToggle(m.file, on)} />}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
