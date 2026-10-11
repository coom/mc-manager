import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Search } from 'lucide-react';
import { MODRINTH_ENTRY_RE } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchHitRow } from './SearchHitRow';
import { describeModsError, type ApiError } from './mods-errors';

/** Champ unique : recherche Modrinth après 300 ms de pause (2 caractères minimum), ou ajout direct d'un slug avec Entrée. */
export function ModSearchBox({ onAdd, pending }: { onAdd: (entry: string, reset: () => void) => void; pending: boolean }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = setTimeout(() => setQuery(text.trim()), 300); return () => clearTimeout(h); }, [text]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, []);
  const enabled = query.length >= 2;
  const { data, isFetching, error } = useQuery({ queryKey: ['mods', 'search', query], queryFn: ({ signal }) => modsApi.search({ q: query }, signal), enabled, staleTime: 60_000 });
  const reset = () => { setText(''); setQuery(''); setOpen(false); };
  const submit = (e: FormEvent) => { e.preventDefault(); const v = text.trim(); if (MODRINTH_ENTRY_RE.test(v)) onAdd(v, reset); };
  return (
    <div ref={box} className="relative space-y-1">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={t('mods.search.placeholder')} className="pl-8 font-mono-data" disabled={pending} />
        </div>
        <Button type="submit" size="sm" disabled={pending || !MODRINTH_ENTRY_RE.test(text.trim())}><Plus className="mr-1 h-3.5 w-3.5" />{t('mods.search.add')}</Button>
      </form>
      <p className="text-xs text-muted-foreground">{t('mods.search.hint')}</p>
      {open && enabled && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-md">
          {data && <p className="px-1 pb-2 text-xs text-muted-foreground">{t('mods.search.filter', { loader: data.loader, version: data.gameVersion ?? t('mods.search.unknownVersion') })}</p>}
          {isFetching && !data && <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('mods.search.searching')}</p>}
          {error && <p className="px-1 text-sm text-destructive">{describeModsError(error as ApiError, t)}</p>}
          {data && data.hits.length === 0 && <p className="px-1 text-sm text-muted-foreground">{t('mods.search.none')}</p>}
          {data?.hits.map((h) => <SearchHitRow key={h.slug} hit={h} listed={h.alreadyListed} pending={pending} onAdd={(slug) => onAdd(slug, reset)} />)}
        </div>
      )}
    </div>
  );
}
