import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useServerStore } from '@/stores/server.store';
import { applyCompletion, complete, type Completion } from './completion';
import { cn } from '@/lib/utils';

const MAX_SHOWN = 20;
const NO_PLAYERS: string[] = [];
// Sélecteurs de cible : une explication entre parenthèses, affichée seulement (le texte inséré reste « @a »).
const HINT_KEYS: Record<string, string> = {
  '@a': 'console.hints.selectorAll', '@e': 'console.hints.selectorEntities', '@p': 'console.hints.selectorNearest',
  '@r': 'console.hints.selectorRandom', '@s': 'console.hints.selectorSelf',
};

export function CommandInput({ onSend }: { onSend: (cmd: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const listId = useId();
  const players = useServerStore((s) => s.info?.players?.names ?? NO_PLAYERS);
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  // Cycle en cours : saisie d'origine (avant insertion), candidats figés et indice choisi.
  const [cycle, setCycle] = useState<{ base: string; completion: Completion; index: number } | null>(null);
  const [hidden, setHidden] = useState(false);

  const live = useMemo(() => (cycle ? cycle.completion : value ? complete(value, players) : null), [cycle, value, players]);
  const shown = !hidden && live && live.candidates.length > 0 ? live : null;
  // Fenêtre d'affichage : glisse pour garder le candidat choisi visible quand on cycle au-delà de MAX_SHOWN.
  const from = cycle ? Math.max(0, cycle.index - MAX_SHOWN + 1) : 0;

  const edit = (next: string) => {
    // Tab a déjà inséré l'espace suivant : un espace tapé par réflexe valide le choix au lieu de doubler
    // (Minecraft refuse deux espaces entre arguments : « Invalid name or UUID »).
    if (cycle && next === value + ' ') { setCycle(null); return; }
    setValue(next); setCycle(null); setHidden(false);
  };

  /** Renvoie false quand il n'y a rien à compléter : Tab garde alors son rôle de navigation. */
  const onTab = (backward: boolean): boolean => {
    if (hidden || !value) return false;
    const completion = cycle?.completion ?? complete(value, players);
    const n = completion.candidates.length;
    if (n === 0) return false;
    const index = cycle ? (cycle.index + (backward ? n - 1 : 1)) % n : backward ? n - 1 : 0;
    const base = cycle?.base ?? value;
    setCycle({ base, completion, index });
    setValue(applyCompletion(base, completion, index));
    return true;
  };

  // Pas d'état "busy" : la valeur est vidée immédiatement, donc un second Entrée ne renvoie rien.
  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      if (onTab(e.shiftKey)) e.preventDefault();
    } else if (e.key === 'Escape') {
      if (shown) { e.preventDefault(); e.stopPropagation(); }
      setCycle(null); setHidden(true);
    } else if (e.key === 'Enter' && value.trim()) {
      // Les suites d'espaces sont réduites : le parseur Brigadier n'en tolère qu'un entre deux arguments.
      const cmd = value.trim().replace(/\s+/g, ' ');
      setHistory((h) => [...h.filter((x) => x !== cmd), cmd].slice(-50));
      setCursor(null); edit('');
      await onSend(cmd);
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next); edit(history[next]);
    } else if (e.key === 'ArrowDown' && cursor !== null) {
      e.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) { setCursor(null); edit(''); } else { setCursor(next); edit(history[next]); }
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  return (
    <div className="flex flex-col gap-1">
      {shown && (
        <div id={listId} role="listbox" aria-label={t('console.suggestions')} className="flex flex-wrap gap-x-3 gap-y-0.5 px-1 font-mono text-xs text-muted-foreground">
          {from > 0 && <span aria-hidden>…</span>}
          {shown.candidates.slice(from, from + MAX_SHOWN).map((c, i) => {
            const selected = cycle !== null && cycle.index === from + i;
            const hint = HINT_KEYS[c];
            return (
              <span key={c} id={optionId(from + i)} role="option" aria-selected={selected} className={cn(selected && 'rounded bg-accent px-1 text-accent-foreground')}>
                {c}{hint && <span className="opacity-60"> ({t(hint)})</span>}
              </span>
            );
          })}
          {shown.candidates.length > from + MAX_SHOWN && <span aria-hidden>+{shown.candidates.length - from - MAX_SHOWN}</span>}
        </div>
      )}
      <Input
        className="font-mono"
        placeholder={t('console.commandPlaceholder')}
        value={value}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={onKeyDown}
        aria-autocomplete="list"
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={shown && cycle ? optionId(cycle.index) : undefined}
      />
    </div>
  );
}
