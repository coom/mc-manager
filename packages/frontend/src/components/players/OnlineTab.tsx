import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { EmptyState } from '@/components/shared/EmptyState';
import { CountryFlag } from './CountryFlag';
import { PlayerActionsMenu } from './PlayerActionsMenu';

export function PlayerName({ name, uuid }: { name: string; uuid: string | null }) {
  const inner = <><img src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/16`} alt="" className="h-4 w-4 rounded-sm" loading="lazy" /><span>{name}</span></>;
  return uuid ? <Link to={`/players/${uuid}`} className="flex items-center gap-2 hover:underline">{inner}</Link> : <span className="flex items-center gap-2">{inner}</span>;
}

export function OnlineTab() {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const { data } = useQuery({ queryKey: ['players', 'online'], queryFn: playersApi.online });
  const { data: lists } = useQuery({ queryKey: ['lists'], queryFn: playersApi.lists, enabled: isAdmin });
  const matches = (e: { uuid: string; name: string }, p: { name: string; uuid: string | null }) => (p.uuid && e.uuid.toLowerCase() === p.uuid.toLowerCase()) || e.name.toLowerCase() === p.name.toLowerCase();
  const items = data?.items ?? [];
  if (data && items.length === 0) return <EmptyState title={t('players.noneOnline')} />;
  return (
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.name')}</th><th>{t('players.since')}</th><th>{t('players.country')}</th>{isAdmin && <th className="w-12" />}</tr></thead>
      <tbody>{items.map((p) => (
        <tr key={p.name} className="border-t">
          <td className="py-2"><PlayerName name={p.name} uuid={p.uuid} /></td>
          <td>{new Date(p.joinedAt).toLocaleString(i18n.language)}</td>
          <td><CountryFlag country={p.country} hasIp={p.hasIp} /></td>
          {isAdmin && <td className="text-right"><PlayerActionsMenu name={p.name} hasIp={p.hasIp} online op={!!lists?.ops.some((e) => matches(e, p))} banned={!!lists?.bannedPlayers.some((e) => matches(e, p))} /></td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}
