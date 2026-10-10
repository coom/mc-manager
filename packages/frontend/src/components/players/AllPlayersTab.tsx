import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/EmptyState';
import { PlayerName } from './OnlineTab';
import { PlayerActionsMenu } from './PlayerActionsMenu';

export function AllPlayersTab() {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;
  const { data } = useQuery({ queryKey: ['players', 'all', q, page], queryFn: () => playersApi.list({ q: q || undefined, page, limit }) });
  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  return (
    <div className="space-y-3">
      <Input className="h-8 max-w-xs" placeholder={t('players.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      {data && data.items.length === 0 ? <EmptyState title={t('players.noneKnown')} /> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.name')}</th><th>{t('players.status')}</th><th>{t('players.lastSeen')}</th><th>{t('players.sessions')}</th>{isAdmin && <th className="w-12" />}</tr></thead>
          <tbody>{(data?.items ?? []).map((p) => (
            <tr key={p.uuid ?? p.name} className="border-t">
              <td className="py-2"><PlayerName name={p.name} uuid={p.uuid} /></td>
              <td className="space-x-1">
                {p.online && <Badge variant="success">{t('players.badges.online')}</Badge>}
                {p.op && <Badge>{t('players.badges.op')}</Badge>}
                {p.whitelisted && <Badge variant="secondary">{t('players.badges.whitelisted')}</Badge>}
                {p.banned && <Badge variant="destructive">{t('players.badges.banned')}</Badge>}
              </td>
              <td>{new Date(p.lastSeenAt).toLocaleString(i18n.language)}</td>
              <td className="font-mono text-xs">{p.sessionCount}</td>
              {isAdmin && <td className="text-right"><PlayerActionsMenu name={p.name} online={p.online} op={p.op} banned={p.banned} /></td>}
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="flex items-center justify-end gap-2 text-xs">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</Button>
        <span>{page} / {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</Button>
      </div>
    </div>
  );
}
