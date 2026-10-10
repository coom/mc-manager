import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { playersApi } from '@/api/players.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { errMsg } from './PlayerActionsMenu';

type Target = { kind: 'player'; name: string } | { kind: 'ip'; ip: string };

export function BansTab() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const status = useServerStore((s) => s.info?.status);
  const ready = status === 'ready' || status === 'unhealthy';
  const { data } = useQuery({ queryKey: ['lists'], queryFn: playersApi.lists });
  const [target, setTarget] = useState<Target | null>(null);
  const lift = useMutation({
    mutationFn: (tg: Target) => (tg.kind === 'player' ? playersApi.pardon(tg.name) : playersApi.pardonIp(tg.ip)),
    onSuccess: () => { toast.success(t('players.done.pardon')); void qc.invalidateQueries({ queryKey: ['lists'] }); void qc.invalidateQueries({ queryKey: ['players'] }); setTarget(null); },
    onError: (e) => { toast.error(errMsg(e, t('shared.error'))); setTarget(null); },
  });
  const fmt = (s: string) => { const d = new Date(s.replace(/ \+(\d{2})(\d{2})$/, '+$1:$2').replace(' ', 'T')); return Number.isNaN(d.getTime()) ? s : d.toLocaleString(i18n.language); };
  if (!data) return null;
  const empty = data.bannedPlayers.length === 0 && data.bannedIps.length === 0;
  return (
    <div className="space-y-6">
      {empty && <EmptyState title={t('players.bans.empty')} />}
      {data.bannedPlayers.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">{t('players.bans.playersTitle')}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">{t('players.name')}</th><th>{t('players.bans.reason')}</th><th>{t('players.bans.created')}</th><th>{t('players.bans.source')}</th>{isAdmin && <th className="w-20" />}</tr></thead>
            <tbody>{data.bannedPlayers.map((b) => (
              <tr key={b.uuid || b.name} className="border-t"><td className="py-2">{b.name}</td><td>{b.reason}</td><td>{fmt(b.created)}</td><td className="text-muted-foreground">{b.source}</td>
                {isAdmin && <td className="text-right"><Button size="sm" variant="outline" disabled={!ready} onClick={() => setTarget({ kind: 'player', name: b.name })}>{t('players.bans.lift')}</Button></td>}</tr>
            ))}</tbody>
          </table>
        </section>
      )}
      {data.bannedIps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">{t('players.bans.ipsTitle')}</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">IP</th><th>{t('players.bans.reason')}</th><th>{t('players.bans.created')}</th><th>{t('players.bans.source')}</th>{isAdmin && <th className="w-20" />}</tr></thead>
            <tbody>{data.bannedIps.map((b) => (
              <tr key={b.ip} className="border-t"><td className="py-2 font-mono text-xs">{b.ip}</td><td>{b.reason}</td><td>{fmt(b.created)}</td><td className="text-muted-foreground">{b.source}</td>
                {isAdmin && <td className="text-right"><Button size="sm" variant="outline" disabled={!ready} onClick={() => setTarget({ kind: 'ip', ip: b.ip })}>{t('players.bans.lift')}</Button></td>}</tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <ConfirmDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)} loading={lift.isPending}
        title={target?.kind === 'player' ? t('players.confirm.pardon', { name: target.name }) : t('players.confirm.pardonIp', { ip: target?.kind === 'ip' ? target.ip : '' })}
        description="" onConfirm={() => target && lift.mutate(target)} />
    </div>
  );
}
