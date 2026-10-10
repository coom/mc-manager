import { useTranslation } from 'react-i18next';
import { Textarea } from '@/components/ui/textarea';

export function changedLineCount(before: string, after: string): number {
  const a = before.split(/\r?\n/); const b = after.split(/\r?\n/);
  const n = Math.max(a.length, b.length);
  let count = 0;
  for (let i = 0; i < n; i++) if ((a[i] ?? '') !== (b[i] ?? '')) count++;
  return count;
}

export function PropertiesRaw({ original, value, onChange }: { original: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const changed = changedLineCount(original, value);
  return (
    <div className="space-y-2">
      <Textarea aria-label="server.properties" className="min-h-[24rem] font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      <p className="text-xs text-muted-foreground">{t('config.changedLines', { count: changed })}</p>
    </div>
  );
}
