import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Loader2, Search } from 'lucide-react';
import { MODRINTH_CATEGORIES, type ModrinthCategory, type ModsSearchIndex } from '@mc/common';
import { modsApi } from '@/api/mods.api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { SearchHitRow } from './SearchHitRow';
import { describeModsError, type ApiError } from './mods-errors';

const SORTS: ModsSearchIndex[] = ['downloads', 'newest', 'updated', 'follows'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `done` est appelé par le parent quand l'ajout a réussi : la ligne passe alors en « Déjà dans la liste ». */
  onAdd: (slug: string, done: () => void) => void;
  pending: boolean;
}

/** Fenêtre de navigation dans le catalogue Modrinth : tri, catégorie, filtre par nom, pagination « Afficher plus ». */
export function CatalogueDialog({ open, onOpenChange, onAdd, pending }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [index, setIndex] = useState<ModsSearchIndex>('downloads');
  const [category, setCategory] = useState<ModrinthCategory | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  useEffect(() => { const h = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(h); }, [text]);
  const { data, isFetching, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['mods', 'catalogue', q, index, category],
    queryFn: ({ pageParam, signal }) => modsApi.search({ q: q || undefined, index, offset: pageParam, category: category ?? undefined }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hits.length > 0 && last.offset + last.hits.length < last.total ? last.offset + last.hits.length : undefined),
    enabled: open,
    staleTime: 60_000,
  });
  const first = data?.pages[0];
  const hits = data?.pages.flatMap((p) => p.hits) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t('mods.catalogue.title')}</DialogTitle>
          <DialogDescription>
            {first ? t('mods.catalogue.count', { loader: first.loader, version: first.gameVersion ?? t('mods.search.unknownVersion'), n: first.total }) : t('mods.catalogue.loading')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mods.catalogue.searchPlaceholder')} className="pl-8" />
          </div>
          <div className="flex gap-1" role="group" aria-label={t('mods.catalogue.sort')}>
            {SORTS.map((s) => (
              <Button key={s} size="sm" variant={index === s ? 'default' : 'outline'} aria-pressed={index === s} onClick={() => setIndex(s)}>{t(`mods.catalogue.sortBy.${s}`)}</Button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}
            className={cn('rounded-full border px-2 py-0.5 text-xs', category === null ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>{t('mods.catalogue.all')}</button>
          {MODRINTH_CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}
              className={cn('rounded-full border px-2 py-0.5 text-xs', category === c ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted/60')}>{t(`mods.categories.${c}`)}</button>
          ))}
        </div>
        <div className="-mx-2 flex-1 overflow-y-auto px-2">
          {error && <p className="px-1 text-sm text-destructive">{describeModsError(error as ApiError, t)}</p>}
          {isFetching && !data && <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('mods.catalogue.loading')}</p>}
          {data && hits.length === 0 && <p className="px-1 text-sm text-muted-foreground">{t('mods.catalogue.empty')}</p>}
          {hits.map((h) => (
            <SearchHitRow key={h.slug} hit={h} listed={h.alreadyListed || added.has(h.slug)} pending={pending}
              onAdd={(slug) => onAdd(slug, () => setAdded((prev) => new Set(prev).add(slug)))} />
          ))}
          {hasNextPage && (
            <div className="flex justify-center py-2">
              <Button size="sm" variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                {isFetchingNextPage ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}{t('mods.catalogue.more')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
