import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import type { ModrinthSearchHit } from '@mc/common';
import { Button } from '@/components/ui/button';

const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Une ligne de résultat Modrinth : icône, titre, auteur, résumé, téléchargements, bouton Ajouter ou « Déjà dans la liste ». */
export function SearchHitRow({ hit, listed, pending, onAdd }: { hit: ModrinthSearchHit; listed: boolean; pending: boolean; onAdd: (slug: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/60">
      {hit.iconUrl ? <img src={hit.iconUrl} alt="" className="h-8 w-8 rounded" /> : <div className="flex h-8 w-8 items-center justify-center rounded bg-muted"><Package className="h-4 w-4 text-muted-foreground" /></div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{hit.title}{hit.author && <span className="ml-2 text-xs font-normal text-muted-foreground">{hit.author}</span>}</p>
        {hit.description && <p className="truncate text-xs text-muted-foreground" title={hit.description}>{hit.description}</p>}
        <p className="text-xs text-muted-foreground">{t('mods.search.downloads', { n: compact(hit.downloads) })}</p>
      </div>
      <Button size="sm" variant={listed ? 'outline' : 'default'} disabled={pending || listed} onClick={() => onAdd(hit.slug)}>{listed ? t('mods.search.listed') : t('mods.search.add')}</Button>
    </div>
  );
}
