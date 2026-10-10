import { Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MoreHorizontal } from 'lucide-react';
import { playersApi } from '@/api/players.api';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ReasonDialog } from './ReasonDialog';

type Action = 'kick' | 'ban' | 'banIp' | 'op' | 'deop' | 'pardon';
interface Props { name: string; hasIp?: boolean; online?: boolean; op?: boolean; banned?: boolean }

export const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback;

/** Menu kick / ban / ban IP / op / deop / pardon ; désactivé quand le serveur n'est pas prêt. */
export function PlayerActionsMenu({ name, hasIp = false, online = false, op = false, banned = false }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const status = useServerStore((s) => s.info?.status);
  const ready = status === 'ready' || status === 'unhealthy';
  const [pending, setPending] = useState<Action | null>(null);
  const run = useMutation({
    mutationFn: async ({ action, reason }: { action: Action; reason?: string }) => {
      switch (action) {
        case 'kick': return playersApi.kick(name, reason);
        case 'ban': return playersApi.ban(name, reason);
        case 'banIp': return playersApi.banIp(name, reason);
        case 'op': return playersApi.op(name);
        case 'deop': return playersApi.deop(name);
        case 'pardon': return playersApi.pardon(name);
      }
    },
    onSuccess: (_d, v) => { toast.success(t(`players.done.${v.action}`, { name })); void qc.invalidateQueries({ queryKey: ['players'] }); void qc.invalidateQueries({ queryKey: ['lists'] }); setPending(null); },
    onError: (e) => { toast.error(errMsg(e, t('shared.error'))); setPending(null); },
  });
  const items: { action: Action; show: boolean; disabled?: boolean; destructive?: boolean }[] = [
    { action: 'kick', show: online, destructive: true },
    { action: 'ban', show: !banned, destructive: true },
    { action: 'banIp', show: online, disabled: !hasIp, destructive: true },
    { action: 'pardon', show: banned },
    { action: 'op', show: !op },
    { action: 'deop', show: op },
  ];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={t('players.actions.menu')} disabled={!ready} title={ready ? undefined : t('players.rconUnavailable')}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.filter((i) => i.show).map((i, idx, arr) => (
            <Fragment key={i.action}>
              <DropdownMenuItem disabled={i.disabled} className={i.destructive ? 'text-destructive' : undefined} onSelect={() => setPending(i.action)}>{t(`players.actions.${i.action}`)}</DropdownMenuItem>
              {i.destructive && arr[idx + 1] && !arr[idx + 1].destructive && <DropdownMenuSeparator />}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReasonDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)} title={pending ? t(`players.confirm.${pending}`, { name }) : ''}
        withReason={pending === 'kick' || pending === 'ban' || pending === 'banIp'} destructive={pending === 'kick' || pending === 'ban' || pending === 'banIp'}
        loading={run.isPending} onConfirm={(reason) => pending && run.mutate({ action: pending, reason })} />
    </>
  );
}
