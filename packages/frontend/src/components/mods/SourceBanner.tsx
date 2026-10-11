import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Copy, Check } from 'lucide-react';
import type { ModsView } from '@mc/common';
import { Button } from '@/components/ui/button';

export function SourceBanner({ view, canAct, onImport, importing }: { view: ModsView; canAct: boolean; onImport: () => void; importing: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (view.source === 'file') return null;
  const copy = () => { void navigator.clipboard?.writeText(view.composeLine).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div>
          <p className="font-medium">{t(`mods.source.${view.source}.title`)}</p>
          <p className="text-muted-foreground">{t(`mods.source.${view.source}.description`)}</p>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">{t('mods.composeLine')}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-background/60 px-2 py-1 font-mono-data text-xs">{view.composeLine}</code>
          <Button size="sm" variant="outline" onClick={copy} aria-label={t('mods.copy')}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button>
        </div>
      </div>
      {canAct && view.source === 'inline' && !view.listingExists && (
        <Button size="sm" disabled={importing} onClick={onImport}>{t('mods.import', { count: view.inlineEntries.length })}</Button>
      )}
    </div>
  );
}
