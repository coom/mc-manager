import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';

export function CommandInput({ onSend }: { onSend: (cmd: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);

  // Pas d'état "busy" : la valeur est vidée immédiatement, donc un second Entrée ne renvoie rien.
  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      const cmd = value.trim();
      setHistory((h) => [...h.filter((x) => x !== cmd), cmd].slice(-50));
      setCursor(null); setValue('');
      await onSend(cmd);
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next); setValue(history[next]);
    } else if (e.key === 'ArrowDown' && cursor !== null) {
      e.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) { setCursor(null); setValue(''); } else { setCursor(next); setValue(history[next]); }
    }
  };

  return <Input className="font-mono" placeholder={t('console.commandPlaceholder')} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} />;
}
