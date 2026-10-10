import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';
export function PlayersCard({ names }: { names: string[] }) {
  const { t } = useTranslation();
  return (
    <Card><CardHeader><CardTitle className="text-sm">{t('dashboard.onlinePlayers')}</CardTitle></CardHeader>
      <CardContent>{names.length === 0 ? <EmptyState title={t('dashboard.noPlayers')} /> : (
        <ul className="flex flex-wrap gap-2">{names.map((n) => (
          <li key={n} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
            <img src={`https://mc-heads.net/avatar/${encodeURIComponent(n)}/16`} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />{n}
          </li>))}</ul>
      )}</CardContent></Card>
  );
}
