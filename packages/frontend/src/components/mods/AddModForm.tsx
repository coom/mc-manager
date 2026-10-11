import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AddModForm({ onAdd, pending }: { onAdd: (entry: string, reset: () => void) => void; pending: boolean }) {
  const { t } = useTranslation();
  const [entry, setEntry] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); const v = entry.trim(); if (v) onAdd(v, () => setEntry('')); };
  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex gap-2">
        <Input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={t('mods.add.placeholder')} className="font-mono-data" disabled={pending} />
        <Button type="submit" size="sm" disabled={pending || !entry.trim()}><Plus className="mr-1 h-3.5 w-3.5" />{t('mods.add.button')}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('mods.add.hint')}</p>
    </form>
  );
}
