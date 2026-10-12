import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Play, Square, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { serverApi } from '@/api/server.api';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { formatUptime } from '@/lib/utils';
import { statusTone, toneClass } from '@/lib/format';
import { cn } from '@/lib/utils';

export function StatusBanner() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const pushed = useServerStore((s) => s.info);
  const { data: fetched } = useQuery({ queryKey: ['server'], queryFn: serverApi.get, enabled: !pushed });
  const info = pushed ?? fetched;
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<'stop' | 'restart' | null>(null);

  const act = useMutation({
    mutationFn: (a: 'start' | 'stop' | 'restart') => serverApi[a](),
    onSuccess: () => { toast.success(t('server.actionAccepted')); void qc.invalidateQueries({ queryKey: ['server'] }); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e.response?.data?.error ?? t('shared.error')),
  });

  if (!info) return null;
  const tone = statusTone(info.status);
  const busy = act.isPending || info.status === 'starting' || info.status === 'stopping';

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
      <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide', toneClass[tone])}>{t(`server.status.${info.status}`)}</span>
      <div className="text-sm text-muted-foreground">
        <span className="font-mono">{info.containerName}</span>
        {info.version && <span className="ml-2">· {info.version}</span>}
        {info.uptimeSeconds != null && <span className="ml-2">· {t('server.uptime')} {formatUptime(info.uptimeSeconds)}</span>}
      </div>
      {info.message && <p className="w-full text-xs text-red-500">{info.message}</p>}
      {isAdmin && (
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || info.status !== 'stopped'} onClick={() => act.mutate('start')}><Play className="mr-1 h-4 w-4" />{t('server.start')}</Button>
          <Button size="sm" variant="outline" disabled={busy || info.status === 'stopped' || info.status === 'unavailable'} onClick={() => setConfirm('restart')}><RotateCcw className="mr-1 h-4 w-4" />{t('server.restart')}</Button>
          <Button size="sm" variant="destructive" disabled={busy || info.status === 'stopped' || info.status === 'unavailable'} onClick={() => setConfirm('stop')}><Square className="mr-1 h-4 w-4" />{t('server.stop')}</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}
        title={t(`server.confirm.${confirm ?? 'stop'}.title`)} description={t(`server.confirm.${confirm ?? 'stop'}.description`)}
        destructive loading={act.isPending}
        onConfirm={() => { if (confirm) act.mutate(confirm); setConfirm(null); }}
      />
    </div>
  );
}
