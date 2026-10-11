import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Map as MapIcon } from 'lucide-react';
import { mapApi } from '@/api/map.api';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/ui/button';

/** Page Carte : intègre l'URL publique configurée (BlueMap, Dynmap...) dans un cadre. Le backend ne la contacte jamais. */
export default function Map() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data, isLoading } = useQuery({ queryKey: ['map'], queryFn: mapApi.get, staleTime: 5 * 60_000 });
  if (isLoading || !data) return <PageLoader />;
  if (!data.url) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold">{t('map.title')}</h1>
        <EmptyState icon={MapIcon} title={t('map.empty')} description={t('map.emptyHint')}>
          {isAdmin && <Button asChild size="sm" className="mt-4"><Link to="/settings">{t('map.configure')}</Link></Button>}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('map.title')}</h1>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <a href={data.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-3.5 w-3.5" />{t('map.openNewTab')}</a>
        </Button>
      </div>
      {/* Même origine et scripts sont nécessaires au viewer BlueMap ; pas de formulaires ni de popups. */}
      <iframe title={t('map.frameTitle')} src={data.url} className="min-h-0 flex-1 rounded-md border border-border bg-black" sandbox="allow-scripts allow-same-origin" allow="fullscreen" />
    </div>
  );
}
