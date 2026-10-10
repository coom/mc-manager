import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import type { BackupEntry, RestoreRequest } from '@mc/common';
import { backupsApi } from '@/api/backups.api';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { BackupTable } from '@/components/backups/BackupTable';
import { BackupRunPanel } from '@/components/backups/BackupRunPanel';
import { RestoreDialog } from '@/components/backups/RestoreDialog';
import { formatBytes } from '@/lib/utils';

export default function Backups() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['backups'], queryFn: backupsApi.list });
  const { data: restoreStatus } = useQuery({ queryKey: ['backups', 'restore-status'], queryFn: backupsApi.restoreStatus });
  const { backupOutput, backupRunning, startBackupOutput, restoreOutput, restoreRunning, restoreResult, startRestoreOutput } = useServerStore();
  const status = useServerStore((s) => s.info?.status);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [toRestore, setToRestore] = useState<BackupEntry | null>(null);
  const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('shared.error');

  const run = useMutation({ mutationFn: () => backupsApi.run(), onMutate: startBackupOutput, onError: (e) => {
    // Hors 409 (sauvegarde déjà en cours), aucun backup.done ne viendra : on libère l'état.
    if ((e as { response?: { status?: number } }).response?.status !== 409) useServerStore.setState({ backupRunning: false });
    toast.error(errMsg(e));
  } });
  const del = useMutation({ mutationFn: backupsApi.remove, onSuccess: () => { toast.success(t('backups.deleted')); void qc.invalidateQueries({ queryKey: ['backups'] }); }, onError: (e) => toast.error(errMsg(e)) });
  const restore = useMutation({
    mutationFn: ({ name, req }: { name: string; req: RestoreRequest }) => backupsApi.restore(name, req),
    onMutate: startRestoreOutput,
    onSuccess: () => setToRestore(null),
    onError: (e) => { useServerStore.setState({ restoreRunning: false }); toast.error(errMsg(e)); setToRestore(null); },
  });
  const restoring = restoreRunning || restoreStatus?.running === true;
  const busy = backupRunning || data?.running === true || restoring;
  const serverStopped = status !== 'ready' && status !== 'unhealthy';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t('backups.title')}</h1>
        {data && <span className="text-sm text-muted-foreground">{t('backups.total', { count: data.entries.length, size: formatBytes(data.totalBytes) })}</span>}
        {isAdmin && <Button className="ml-auto" size="sm" disabled={busy || run.isPending} onClick={() => run.mutate()}><Archive className="mr-1 h-4 w-4" />{t('backups.runNow')}</Button>}
      </div>
      {(restoring || restoreOutput.length > 0 || restoreResult) ? (
        <BackupRunPanel mode="restore" lines={restoreOutput} running={restoring} result={restoreResult} onRestoreSafety={(n) => { const e = data?.entries.find((x) => x.name === n); if (e) setToRestore(e); }} />
      ) : <BackupRunPanel lines={backupOutput} running={backupRunning || data?.running === true} />}
      <Card><CardContent className="p-4">
        {data && data.entries.length === 0 ? <EmptyState title={t('backups.empty')} /> :
          <BackupTable entries={data?.entries ?? []} isAdmin={isAdmin} busy={busy} onRestore={(n) => { const e = data?.entries.find((x) => x.name === n); if (e) setToRestore(e); }} onDownload={(n) => void backupsApi.download(n).catch((e) => toast.error(errMsg(e)))} onDelete={setToDelete} />}
      </CardContent></Card>
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} title={t('backups.confirmDelete.title')} description={t('backups.confirmDelete.description', { name: toDelete })} destructive loading={del.isPending} onConfirm={() => { if (toDelete) del.mutate(toDelete); setToDelete(null); }} />
      <RestoreDialog entry={toRestore} open={toRestore !== null} onOpenChange={(o) => !o && setToRestore(null)} loading={restore.isPending} serverStopped={serverStopped}
        onConfirm={(req) => { if (toRestore) restore.mutate({ name: toRestore.name, req }); }} />
    </div>
  );
}
