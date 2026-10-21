import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BackupEntry, RestoreRequest } from '@mc/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface Props {
  entry: BackupEntry | null; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (req: RestoreRequest) => void; loading: boolean;
  serverStopped: boolean;
  /** mc-backup arrêté ou introuvable : la sauvegarde de sécurité est impossible. */
  backupStopped: boolean;
}

/** Confirmation de restauration : sauvegarde de sécurité facultative (cochée par défaut quand elle est possible). */
export function RestoreDialog({ entry, open, onOpenChange, onConfirm, loading, serverStopped, backupStopped }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && entry && <Body entry={entry} loading={loading} serverStopped={serverStopped} backupStopped={backupStopped} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />}</DialogContent>
    </Dialog>
  );
}

function Body({ entry, loading, serverStopped, backupStopped, onCancel, onConfirm }: { entry: BackupEntry; loading: boolean; serverStopped: boolean; backupStopped: boolean; onCancel: () => void; onConfirm: (r: RestoreRequest) => void }) {
  const { t, i18n } = useTranslation();
  const safetyPossible = !serverStopped && !backupStopped;
  const [startAfter, setStartAfter] = useState(true);
  const [safety, setSafety] = useState(true);
  const safetyBackup = safetyPossible && safety;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('backups.confirmRestore.title', { name: entry.name })}</DialogTitle>
        <DialogDescription>{new Date(entry.modifiedAt).toLocaleString(i18n.language)} — {t('backups.confirmRestore.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Checkbox id="restore-safety" checked={safetyBackup} disabled={!safetyPossible} onCheckedChange={(v) => setSafety(v === true)} />
          <Label htmlFor="restore-safety">{t('backups.confirmRestore.safety')}</Label>
        </div>
        {!safetyPossible && <p className="pl-6 text-xs text-muted-foreground">{t(serverStopped ? 'backups.confirmRestore.safetyServerStopped' : 'backups.confirmRestore.safetyBackupStopped')}</p>}
        <div className="flex items-center gap-2"><Checkbox id="restore-start-after" checked={startAfter} onCheckedChange={(v) => setStartAfter(v === true)} /><Label htmlFor="restore-start-after">{t('backups.confirmRestore.startAfter')}</Label></div>
      </div>
      {!safetyBackup && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">{t('backups.confirmRestore.noSafety')}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>{t('shared.cancel')}</Button>
        <Button variant="destructive" disabled={loading} onClick={() => onConfirm({ startAfter, safetyBackup })}>{loading ? t('shared.processing') : t('backups.confirmRestore.confirm')}</Button>
      </DialogFooter>
    </>
  );
}
