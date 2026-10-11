import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Package, Trash2 } from 'lucide-react';
import type { ModrinthMod, ModsView } from '@mc/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ModSearchBox } from './ModSearchBox';

interface Props {
  view: ModsView; canAct: boolean; pending: boolean;
  onAdd: (entry: string, reset: () => void) => void;
  onToggle: (entry: string, enabled: boolean) => void;
  onRemove: (entry: string) => void;
}

export function ModrinthList({ view, canAct, pending, onAdd, onToggle, onRemove }: Props) {
  const { t } = useTranslation();
  const [toRemove, setToRemove] = useState<ModrinthMod | null>(null);
  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">{t('mods.modrinth.title')}</CardTitle>
        {canAct && <ModSearchBox onAdd={onAdd} pending={pending} />}
      </CardHeader>
      <CardContent className="space-y-2">
        {view.modrinth.length === 0 && <p className="text-sm text-muted-foreground">{t('mods.modrinth.empty')}</p>}
        {view.modrinth.map((m) => (
          <div key={m.entry} className="flex items-center gap-3 rounded-md border border-border p-2">
            {m.iconUrl ? <img src={m.iconUrl} alt="" className="h-8 w-8 rounded" /> : <div className="flex h-8 w-8 items-center justify-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></div>}
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-baseline gap-2">
                <a href={`https://modrinth.com/project/${encodeURIComponent(m.slug)}`} target="_blank" rel="noopener noreferrer" title={t('mods.modrinth.open')}
                  className="group inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium hover:underline">
                  <span className="truncate">{m.title ?? m.slug}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                </a>
                <span className="truncate font-mono-data text-xs text-muted-foreground">{m.entry}</span>
              </p>
              {m.description && <p className="truncate text-xs text-muted-foreground" title={m.description}>{m.description}</p>}
            </div>
            {/* État voulu ≠ manifeste → en attente ; actif et installé → installé ; désactivé et absent → non installé. */}
            <Badge variant={m.installed !== m.enabled ? 'warning' : m.installed ? 'success' : 'secondary'}>
              {m.installed !== m.enabled ? t('mods.modrinth.pending') : m.installed ? t('mods.modrinth.installed') : t('mods.modrinth.absent')}
            </Badge>
            {canAct && (
              <>
                <Switch aria-label={m.entry} checked={m.enabled} disabled={pending} onCheckedChange={(on) => onToggle(m.entry, on)} />
                <Button size="sm" variant="ghost" aria-label={t('mods.remove.button')} disabled={pending} onClick={() => setToRemove(m)}><Trash2 className="h-4 w-4" /></Button>
              </>
            )}
          </div>
        ))}
        {view.unmanagedLines.length > 0 && (
          <div className="pt-2">
            <p className="mb-1 text-xs text-muted-foreground">{t('mods.modrinth.unmanaged')}</p>
            {view.unmanagedLines.map((l, i) => (
              <p key={i} className="font-mono-data text-xs text-muted-foreground" title={l.invalid ? t('mods.modrinth.invalidLine') : undefined}>
                {l.invalid && <span className="mr-1 text-amber-500" aria-label={t('mods.modrinth.invalidLine')}>⚠</span>}
                <span>{l.raw}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
      <ConfirmDialog open={toRemove !== null} onOpenChange={(o) => { if (!o) setToRemove(null); }} title={t('mods.remove.title', { entry: toRemove?.entry ?? '' })} description={t('mods.remove.description')} destructive loading={pending} onConfirm={() => { if (toRemove) onRemove(toRemove.entry); setToRemove(null); }} />
    </Card>
  );
}
