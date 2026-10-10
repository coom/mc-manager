import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { playersApi } from '@/api/players.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/shared/EmptyState';

/** Noms depuis le tick métriques (lot 1) ; les UUID viennent du journal pour rendre chaque joueur cliquable. */
export function PlayersCard({ names }: { names: string[] }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['players', 'online'], queryFn: playersApi.online, enabled: names.length > 0 });
  const uuidOf = (n: string) => data?.items.find((p) => p.name === n)?.uuid ?? null;
  return (
    <Card><CardHeader><CardTitle className="text-sm">{t('dashboard.onlinePlayers')}</CardTitle></CardHeader>
      <CardContent>{names.length === 0 ? <EmptyState title={t('dashboard.noPlayers')} /> : (
        <ul className="flex flex-wrap gap-2">{names.map((n) => {
          const uuid = uuidOf(n);
          const body = <><img src={`https://mc-heads.net/avatar/${encodeURIComponent(n)}/16`} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />{n}</>;
          return <li key={n} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">{uuid ? <Link to={`/players/${uuid}`} className="flex items-center gap-2 hover:underline">{body}</Link> : body}</li>;
        })}</ul>
      )}</CardContent></Card>
  );
}
