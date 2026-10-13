import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertCircle, Archive, RefreshCw, Trash2 } from 'lucide-react';
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
import { BackupScheduleCard } from '@/components/backups/BackupScheduleCard';
import { describeBackupError } from '@/components/backups/backup-errors';
import { summarizeNames } from '@/components/backups/names-summary';
import type { ApiError } from '@/components/mods/mods-errors';
import { formatBytes } from '@/lib/utils';

export default function Backups() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const qc = useQueryClient();
  const refreshing = useIsFetching({ queryKey: ['backups'] }) > 0;
  const { data, dataUpdatedAt: listUpdatedAt } = useQuery({ queryKey: ['backups'], queryFn: backupsApi.list });
  const { data: restoreStatus, dataUpdatedAt: restoreUpdatedAt } = useQuery({ queryKey: ['backups', 'restore-status'], queryFn: backupsApi.restoreStatus });
  // Instant de lancement côté client : une réponse antérieure ne doit pas effacer l'état « en cours ».
  const backupStartedAt = useRef(0);
  const restoreStartedAt = useRef(0);
  const { backupOutput, backupRunning, startBackupOutput, restoreOutput, restoreRunning, restoreResult, startRestoreOutput } = useServerStore();
  const status = useServerStore((s) => s.info?.status);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [toRestore, setToRestore] = useState<BackupEntry | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const errMsg = (e: unknown) => (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? t('shared.error');

  const run = useMutation({ mutationFn: () => backupsApi.run(), onMutate: () => { backupStartedAt.current = Date.now(); startBackupOutput(); }, onError: (e) => {
    // Hors 409 (sauvegarde déjà en cours), aucun backup.done ne viendra : on libère l'état.
    if ((e as { response?: { status?: number } }).response?.status !== 409) useServerStore.setState({ backupRunning: false });
    toast.error(errMsg(e));
  } });
  const del = useMutation({ mutationFn: backupsApi.remove, onSuccess: () => { toast.success(t('backups.deleted')); void qc.invalidateQueries({ queryKey: ['backups'] }); }, onError: (e) => toast.error(errMsg(e)) });
  const bulk = useMutation({
    mutationFn: (names: string[]) => backupsApi.removeMany(names),
    onSuccess: (r) => { toast.success(t('backups.selection.deleted', { count: r.deleted.length })); setSelected(new Set()); void qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e) => { toast.error(describeBackupError(e as ApiError, t)); void qc.invalidateQueries({ queryKey: ['backups'] }); },
    onSettled: () => setConfirmBulk(false),
  });
  // Sélection restreinte aux archives encore listées (une archive nettoyée par mc-backup n'est ni comptée ni envoyée),
  // dans l'ordre de la liste (plus récente d'abord) pour la confirmation et la requête.
  const selectedNames = (data?.entries ?? []).filter((e) => selected.has(e.name)).map((e) => e.name);
  const toggle = (name: string, checked: boolean) => setSelected((s) => { const next = new Set(s); if (checked) next.add(name); else next.delete(name); return next; });
  const restore = useMutation({
    mutationFn: ({ name, req }: { name: string; req: RestoreRequest }) => backupsApi.restore(name, req),
    onMutate: () => { restoreStartedAt.current = Date.now(); startRestoreOutput(); },
    onSuccess: () => setToRestore(null),
    onError: (e) => { useServerStore.setState({ restoreRunning: false }); toast.error(errMsg(e)); setToRestore(null); },
  });
  const dismiss = useMutation({
    mutationFn: () => backupsApi.dismissInterrupted(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['backups', 'restore-status'] }),
    onError: (e) => toast.error(errMsg(e)),
  });
  // Un `restore.done` / `backup.done` perdu pendant une coupure WebSocket laisserait l'état « en cours » collé :
  // une réponse du serveur plus récente que le lancement, qui dit « terminé », le libère.
  const restorePending = restore.isPending;
  const runPending = run.isPending;
  useEffect(() => {
    if (restoreStatus && !restoreStatus.running && !restorePending && restoreUpdatedAt > restoreStartedAt.current && useServerStore.getState().restoreRunning) {
      useServerStore.setState({ restoreRunning: false });
    }
  }, [restoreStatus, restoreUpdatedAt, restorePending]);
  useEffect(() => {
    if (data && !data.running && !runPending && listUpdatedAt > backupStartedAt.current && useServerStore.getState().backupRunning) {
      useServerStore.setState({ backupRunning: false });
    }
  }, [data, listUpdatedAt, runPending]);
  const interrupted = restoreStatus?.interrupted ?? null;
  const restoring = restoreRunning || restoreStatus?.running === true;
  const busy = backupRunning || data?.running === true || restoring;
  const serverStopped = status !== 'ready' && status !== 'unhealthy';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold">{t('backups.title')}</h1>
        {data && <span className="text-sm text-muted-foreground">{t('backups.total', { count: data.entries.length, size: formatBytes(data.totalBytes) })}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {/* Relit la liste, l'état de restauration et la planification (la liste est aussi poussée par WebSocket). */}
          <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void qc.invalidateQueries({ queryKey: ['backups'] })}>
            <RefreshCw className={`mr-1 h-4 w-4${refreshing ? ' animate-spin' : ''}`} />{t('backups.refresh')}
          </Button>
          {isAdmin && <Button size="sm" disabled={busy || run.isPending} onClick={() => run.mutate()}><Archive className="mr-1 h-4 w-4" />{t('backups.runNow')}</Button>}
        </div>
      </div>
      {interrupted && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 text-amber-500" />{t('backups.interrupted.title')}</div>
          <p>{t('backups.interrupted.description', { archive: interrupted.archive })}</p>
          {interrupted.safetyBackup && <p>{t('backups.restoreSafety', { name: interrupted.safetyBackup })}</p>}
          {isAdmin && (
            <div className="flex gap-2">
              {interrupted.safetyBackup && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { const n = interrupted.safetyBackup!; setToRestore(data?.entries.find((x) => x.name === n) ?? { name: n, size: 0, modifiedAt: new Date().toISOString() }); }}>{t('backups.restoreThis')}</Button>
              )}
              <Button size="sm" variant="outline" disabled={busy || dismiss.isPending} onClick={() => dismiss.mutate()}>{t('backups.interrupted.dismiss')}</Button>
            </div>
          )}
        </div>
      )}
      <BackupScheduleCard isAdmin={isAdmin} busy={busy} />
      {(restoring || restoreOutput.length > 0 || restoreResult) ? (
        <BackupRunPanel mode="restore" lines={restoreOutput} running={restoring} result={restoreResult} onRestoreSafety={isAdmin && !busy ? (n) => setToRestore(data?.entries.find((x) => x.name === n) ?? { name: n, size: 0, modifiedAt: new Date().toISOString() }) : undefined} />
      ) : <BackupRunPanel lines={backupOutput} running={backupRunning || data?.running === true} />}
      <Card><CardContent className="p-4">
        {isAdmin && data && data.entries.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setSelected(new Set(data.entries.map((e) => e.name)))}>{t('backups.selection.all')}</Button>
            <Button variant="link" size="sm" className="h-auto px-0" disabled={selectedNames.length === 0} onClick={() => setSelected(new Set())}>{t('backups.selection.none')}</Button>
            <Button variant="destructive" size="sm" className="ml-auto" disabled={selectedNames.length === 0 || busy || bulk.isPending} onClick={() => setConfirmBulk(true)}>
              <Trash2 className="mr-1 h-4 w-4" />{t('backups.selection.delete', { count: selectedNames.length })}
            </Button>
          </div>
        )}
        {data && data.entries.length === 0 ? <EmptyState title={t('backups.empty')} /> :
          <BackupTable entries={data?.entries ?? []} isAdmin={isAdmin} busy={busy} onRestore={(n) => { const e = data?.entries.find((x) => x.name === n); if (e) setToRestore(e); }} onDownload={(n) => void backupsApi.download(n).catch((e) => toast.error(errMsg(e)))} onDelete={setToDelete}
            selected={selected} onToggle={toggle} />}
      </CardContent></Card>
      <ConfirmDialog open={confirmBulk} onOpenChange={(o) => { if (!o && !bulk.isPending) setConfirmBulk(false); }}
        title={t('backups.selection.confirmTitle', { count: selectedNames.length })}
        description={t('backups.selection.confirmDescription', { names: summarizeNames(selectedNames, t) })}
        destructive loading={bulk.isPending} onConfirm={() => { if (!bulk.isPending && selectedNames.length > 0) bulk.mutate(selectedNames); }} />
      <ConfirmDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)} title={t('backups.confirmDelete.title')} description={t('backups.confirmDelete.description', { name: toDelete })} destructive loading={del.isPending} onConfirm={() => { if (toDelete) del.mutate(toDelete); setToDelete(null); }} />
      <RestoreDialog entry={toRestore} open={toRestore !== null} onOpenChange={(o) => !o && setToRestore(null)} loading={restore.isPending} serverStopped={serverStopped}
        onConfirm={(req) => { if (toRestore) restore.mutate({ name: toRestore.name, req }); }} />
    </div>
  );
}
